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
  } = {},
): Browsers & { reset(): Promise<void> } {
  const profile = options.profile ?? "amuse";
  const desktop = options.desktop ?? resize;
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
    async reset() {
      // these nodes are ours alone: sessions still live there were left by an earlier process
      await Promise.all(
        nodes.map(async (n) =>
          Promise.all(
            (await n.controller.live()).map((s) =>
              n.controller.delete(s).catch(() => {}),
            ),
          ),
        ),
      );
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
      await r.node.controller.delete(r.session).catch(() => {});
      release(r.node);
    },
    vnc: (id) => runs.get(id)?.node.vnc ?? null,
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
