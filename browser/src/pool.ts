/**
 * Browser runs on a pool of auto-browser nodes. A node has one desktop, so a
 * run leases a whole node (one controller session) and gives it back when it
 * closes; when every node is busy, runs wait their turn (and leave the queue
 * if they are stopped). The agent sees elements by refs this pool issues
 * (e1, e2, …): only refs from the run's latest look are accepted, and any
 * step that changes the URL retires them all — a stale ref is refused, never
 * retargeted.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type Controller,
  ControllerError,
  type Element,
  type Observation,
} from "./controller.ts";
import { type Size, fitted, resize, standard } from "./desktop.ts";

export interface Node {
  name: string;
  controller: Controller;
  /** noVNC's websocket on this node (…/websockify), for the live view and takeover */
  vnc: string;
  /**
   * A folder this process and the controller share, for handing a file to an
   * upload: where it is here (`local`) and where the controller sees it
   * (`remote`, inside its upload root). Only the file being uploaded is put
   * there, and only while it is. Without one, the node takes no uploads.
   */
  handoff?: { local: string; remote: string };
}

/**
 * Where each open run's node and controller session are kept, so a restart can adopt them
 * again instead of leaving the session behind on the controller (a row each).
 */
export interface BrowserSessions {
  list(): { id: string; node: string; session: string }[];
  save(id: string, node: string, session: string): void;
  forget(id: string): void;
}

/** What a start found: the browsers it took up again, the ones it could not, and the sessions it closed. */
export interface Reconciled {
  /** the browsers that are open again, on the session they were on */
  adopted: string[];
  /** the browsers the state lists as open that no session is left for, with why */
  lost: { id: string; reason: string }[];
  /** how many sessions no browser owned were closed */
  closed: number;
}

/** A file, by name and bytes. */
export interface FileData {
  name: string;
  data: Uint8Array;
}

export type Step =
  | { kind: "click"; ref: string }
  | { kind: "type"; ref: string; text: string; submit: boolean }
  | { kind: "press"; key: string }
  | { kind: "navigate"; url: string }
  | { kind: "scroll"; direction: "up" | "down" };

export interface PageView {
  url: string;
  title: string;
  text: string;
  elements: {
    ref: string;
    role: string;
    label: string;
    href: string | null;
    disabled: boolean;
  }[];
}

/** What the browser agent and the API need from browsers, per run. */
export interface Browsers {
  /**
   * Lease a browser and open `url`; waits while the pool is busy (rejects if `signal` aborts first),
   * or, with `wait: false`, rejects at once with PoolFull.
   */
  open(
    run: string,
    url: string,
    signal?: AbortSignal,
    options?: { wait?: boolean },
  ): Promise<void>;
  look(run: string): Promise<PageView>;
  step(run: string, step: Step): Promise<void>;
  screenshot(run: string): Promise<Uint8Array | null>;
  /** Keep this run's logins for later runs (the user just held the browser). */
  remember(run: string): Promise<void>;
  /** The sites logins are kept for (shared by every browser), with how many cookies. */
  logins(): Promise<{ site: string; cookies: number }[]>;
  /** Forget a site's logins: from what is kept, and from every browser open now. */
  forgetLogin(site: string): Promise<void>;
  /** Shape the run's desktop for a viewer of this size; null: back to the agent's standard size. */
  fit(run: string, viewer: Size | null): Promise<void>;
  close(run: string): Promise<void>;
  /** The run's live desktop (noVNC websocket), while it has one. */
  vnc(run: string): string | null;
  /** Whether the pool holds this run open: a browser the state lists, whose controller session it has. */
  holds(run: string): boolean;
  /** Put a file into the file input `ref`: the browser gets the file itself, never a path of ours. */
  upload(run: string, ref: string, file: FileData): Promise<void>;
  /** What the run's pages have downloaded since the last time this was asked. */
  downloads(run: string): Promise<FileData[]>;
  /** Whether the run's window is still open: false once the user has closed it (in the browser itself). Unsure counts as open. */
  stillOpen(run: string): Promise<boolean>;
}

/** Every browser there is is in use. */
export class PoolFull extends Error {
  constructor(size: number) {
    super(`All ${size} browsers are in use; close one first.`);
  }
}

export class StaleRef extends Error {
  constructor(ref: string) {
    super(
      `Unknown or stale element ref "${ref.slice(0, 40)}". Look at the page again and use a fresh ref.`,
    );
  }
}

interface Run {
  node: Node;
  session: string;
  /** ref → controller id, for the latest look only */
  current: Map<string, string>;
  /** controller id → ref, stable for the run so an element keeps its ref */
  refs: Map<string, string>;
  /** downloads already handed over */
  taken: Set<string>;
  /** sites signed out of while it was open: its storage of them (not only cookies) is not to be saved back */
  forgotten: Set<string>;
}

const describe = (e: Element) => e.label?.trim() || e.href || e.tag || "";

export function browserPool(
  nodes: Node[],
  options: {
    profile?: string;
    desktop?: (vnc: string, size: Size) => Promise<void>;
    sessions?: BrowserSessions;
  } = {},
): Browsers & { reconcile(open: readonly string[]): Promise<Reconciled> } {
  const profile = options.profile ?? "amuse";
  const desktop = options.desktop ?? resize;
  const sessions = options.sessions;
  const free = [...nodes];
  const waiting: {
    take: (node: Node) => void;
    signal: AbortSignal | undefined;
  }[] = [];
  const runs = new Map<string, Run>();

  const lease = (signal?: AbortSignal) =>
    new Promise<Node>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("stopped"));
      const node = free.pop();
      if (node) return resolve(node);
      const onAbort = () => {
        const at = waiting.indexOf(entry);
        if (at >= 0) waiting.splice(at, 1);
        reject(new Error("stopped"));
      };
      const entry = {
        take: (node: Node) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(node);
        },
        signal,
      };
      waiting.push(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  const release = (node: Node) => {
    const next = waiting.shift();
    if (next) next.take(node);
    else free.push(node);
  };

  const run = (id: string) => {
    const r = runs.get(id);
    if (!r) throw new Error(`browser run ${id} is not open`);
    return r;
  };
  /** Take a node for a run adopted again: it is not free any more. */
  const adopt = (id: string, node: Node, session: string) => {
    free.splice(free.indexOf(node), 1);
    runs.set(id, { node, session, current: new Map(), refs: new Map(), taken: new Set(), forgotten: new Set() });
  };
  const viewOf = (r: Run, o: Observation): PageView => {
    r.current = new Map();
    const elements = o.interactables.map((e) => {
      let ref = r.refs.get(e.element_id);
      if (!ref) {
        ref = `e${r.refs.size + 1}`;
        r.refs.set(e.element_id, ref);
      }
      r.current.set(ref, e.element_id);
      return {
        ref,
        role: e.role ?? e.tag ?? "element",
        label: describe(e),
        href: e.href,
        disabled: e.disabled === true,
      };
    });
    return { url: o.url, title: o.title, text: o.text_excerpt ?? "", elements };
  };
  const target = (r: Run, ref: string) => {
    const id = r.current.get(ref);
    if (!id) throw new StaleRef(ref);
    return id;
  };
  /** Act; refs are retired when the step moved the page somewhere else. */
  const act = async (r: Run, action: Parameters<Controller["act"]>[1]) => {
    const { before, after } = await r.node.controller.act(r.session, action);
    if (after && before !== after.url) r.current = new Map();
  };

  return {
    /**
     * What an earlier process left on the controllers: the session of a browser the state still lists as open is
     * adopted again (its preview, live view and takeover work as before), one that is gone closes its browser
     * instead, and a session no browser owns is closed. These nodes are ours alone, so anything live on one is ours
     * to close. A controller that does not answer is left as it is: nothing there is adopted, closed or called lost.
     */
    async reconcile(open) {
      const listed = new Set(open);
      const rows = new Map((sessions?.list() ?? []).map((row) => [row.id, row]));
      const adopted: string[] = [];
      const lost: { id: string; reason: string }[] = [];
      let closed = 0;
      // a node this pool no longer has: the browser cannot be adopted, and its session is out of reach
      for (const [id, row] of rows) {
        if (nodes.some((n) => n.name === row.node)) continue;
        sessions?.forget(id);
        rows.delete(id);
        if (listed.has(id)) lost.push({ id, reason: `its browser node ${row.node} is not configured any more` });
      }
      for (const node of nodes) {
        const live = await node.controller.live().catch(() => null);
        if (!live) continue;
        const mine = new Set<string>();
        for (const [id, row] of rows) {
          if (row.node !== node.name) continue;
          rows.delete(id);
          if (!listed.has(id) || !live.includes(row.session)) {
            // the browser is closed in the state, or its session is gone: either way the row goes, and the session is a stray
            sessions?.forget(id);
            if (listed.has(id)) lost.push({ id, reason: "its browser session is gone" });
            continue;
          }
          mine.add(row.session);
          adopt(id, node, row.session);
          adopted.push(id);
        }
        for (const session of live) {
          if (mine.has(session)) continue;
          await node.controller.delete(session).catch(() => {});
          closed++;
        }
      }
      // a browser the state lists as open that no session is kept for (opened before this, or a row lost with it):
      // one whose row is still here is on a controller that did not answer, and is left alone
      for (const id of open) if (!adopted.includes(id) && !lost.some((one) => one.id === id) && !rows.has(id)) lost.push({ id, reason: "no session is kept for it" });
      return { adopted, lost, closed };
    },
    async open(id, url, signal, { wait = true } = {}) {
      if (!wait && free.length === 0) throw new PoolFull(nodes.length);
      const node = await lease(signal);
      try {
        // the last user may have left the desktop in their screen's shape; a run starts at the standard size
        await desktop(node.vnc, standard).catch(() => {});
        const session = await node.controller
          .create(url, profile)
          .catch(() => node.controller.create(url, null)); // no saved logins yet
        if (signal?.aborted) {
          await node.controller.delete(session).catch(() => {});
          throw new Error("stopped");
        }
        runs.set(id, {
          node,
          session,
          current: new Map(),
          refs: new Map(),
          taken: new Set(),
          forgotten: new Set(),
        });
        sessions?.save(id, node.name, session);
      } catch (error) {
        release(node);
        throw error;
      }
    },
    async look(id) {
      const r = run(id);
      return viewOf(r, await r.node.controller.observe(r.session));
    },
    async step(id, step) {
      const r = run(id);
      switch (step.kind) {
        case "click":
          return act(r, {
            name: "click",
            body: { element_id: target(r, step.ref) },
          });
        case "type": {
          const element_id = target(r, step.ref);
          if (step.text.length > 5000)
            throw new Error(
              "That text is too long to type at once (5000 characters at most).",
            );
          if (step.text)
            await act(r, {
              name: "type",
              body: { element_id, text: step.text, clear_first: true },
            });
          else {
            // the controller refuses empty text: clear the field by hand
            await act(r, { name: "click", body: { element_id } });
            await act(r, { name: "press", body: { key: "Control+a" } });
            await act(r, { name: "press", body: { key: "Delete" } });
          }
          if (step.submit)
            await act(r, { name: "press", body: { key: "Enter" } });
          return;
        }
        case "press":
          return act(r, { name: "press", body: { key: step.key } });
        case "navigate": {
          if (
            !URL.canParse(step.url) ||
            !/^https?:$/.test(new URL(step.url).protocol)
          )
            throw new Error(`"${step.url}" is not an http(s) URL.`);
          return act(r, {
            name: "navigate",
            body: { url: new URL(step.url).href },
          });
        }
        case "scroll":
          return act(r, {
            name: "scroll",
            body: {
              delta_x: 0,
              delta_y: step.direction === "down" ? 700 : -700,
            },
          });
      }
    },
    async screenshot(id) {
      const r = runs.get(id);
      return r
        ? r.node.controller.screenshot(r.session).catch(() => null)
        : null;
    },
    async remember(id) {
      const r = run(id);
      await r.node.controller.saveProfile(r.session, profile);
      // what was signed out of while it was open stays signed out (its pages' storage came back with the save)
      for (const site of r.forgotten) await r.node.controller.forgetProfileSite(profile, site).catch(() => {});
    },
    // the profile is shared (one logins volume for every controller): any node reads it
    async logins() {
      const node = nodes[0];
      if (!node) return [];
      const sites = await node.controller.profileSites(profile).catch((e: unknown) => (e instanceof ControllerError && e.status === 404 ? [] : Promise.reject(e)));
      // a site's stored data without a cookie is no login
      return sites.filter((s) => s.cookies > 0);
    },
    async forgetLogin(site) {
      const node = nodes[0];
      if (!node) return;
      await node.controller.forgetProfileSite(profile, site).catch((e: unknown) => (e instanceof ControllerError && e.status === 404 ? undefined : Promise.reject(e)));
      // an open browser would save it back when it is next remembered
      await Promise.all(
        [...runs.values()].map((r) => {
          r.forgotten.add(site);
          return r.node.controller.clearSessionSite(r.session, site).catch(() => {});
        }),
      );
    },
    async fit(id, viewer) {
      await desktop(run(id).node.vnc, viewer ? fitted(viewer) : standard);
    },
    async close(id) {
      const r = runs.get(id);
      if (!r) return;
      runs.delete(id);
      sessions?.forget(id);
      await r.node.controller.delete(r.session).catch(() => {});
      release(r.node);
    },
    vnc: (id) => runs.get(id)?.node.vnc ?? null,
    holds: (id) => runs.has(id),
    async upload(id, ref, file) {
      const r = run(id);
      const { handoff } = r.node;
      if (!handoff) throw new Error("This browser cannot take files.");
      const element_id = target(r, ref);
      // a folder per run, readable by the controller (which runs without the power to read past permissions)
      const name = basename(file.name.replaceAll("\\", "/")) || "file";
      const folder = join(handoff.local, id);
      await mkdir(folder, { recursive: true, mode: 0o755 });
      await writeFile(join(folder, name), file.data, { mode: 0o644 });
      try {
        await act(r, {
          name: "upload",
          body: {
            element_id,
            file_path: `${handoff.remote}/${id}/${name}`,
            approved: true,
          },
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
    async stillOpen(id) {
      const r = runs.get(id);
      if (!r) return false;
      // a window seen to have no tabs is closed, as is a session the controller no longer has (it restarted);
      // a controller that does not answer is not taken for that
      const tabs = await r.node.controller
        .tabs(r.session)
        .catch((error: unknown) =>
          error instanceof ControllerError && error.status === 404 ? 0 : 1,
        );
      return tabs > 0;
    },
    async downloads(id) {
      const r = run(id);
      const done = (await r.node.controller.downloads(r.session)).filter(
        (d) => d.status === "completed" && !r.taken.has(d.url),
      );
      const files: FileData[] = [];
      for (const d of done) {
        r.taken.add(d.url);
        files.push({
          name: d.filename,
          data: await r.node.controller.artifact(d.url),
        });
      }
      return files;
    },
  };
}
