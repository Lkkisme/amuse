/**
 * Browser runs on a pool of auto-browser nodes. A node has one desktop, so a
 * run leases a whole node (one controller session) and gives it back when it
 * closes; when every node is busy, runs wait their turn (and leave the queue
 * if they are stopped). The agent sees elements by refs this pool issues
 * (e1, e2, …): only refs from the run's latest look are accepted, and any
 * step that changes the URL retires them all — a stale ref is refused, never
 * retargeted.
 */
import type { Controller, Element, Observation } from "./controller.ts";

export interface Node {
  name: string;
  controller: Controller;
  /** noVNC's websocket on this node (…/websockify), for the live view and takeover */
  vnc: string;
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
  elements: { ref: string; role: string; label: string; href: string | null; disabled: boolean }[];
}

/** What the browser agent and the API need from browsers, per run. */
export interface Browsers {
  /** Lease a browser and open `url`; waits while the pool is busy; rejects if `signal` aborts first. */
  open(run: string, url: string, signal?: AbortSignal): Promise<void>;
  look(run: string): Promise<PageView>;
  step(run: string, step: Step): Promise<void>;
  screenshot(run: string): Promise<Uint8Array | null>;
  /** Keep this run's logins for later runs (the user just held the browser). */
  remember(run: string): Promise<void>;
  close(run: string): Promise<void>;
  /** The run's live desktop (noVNC websocket), while it has one. */
  vnc(run: string): string | null;
}

export class StaleRef extends Error {
  constructor(ref: string) {
    super(`Unknown or stale element ref "${ref.slice(0, 40)}". Look at the page again and use a fresh ref.`);
  }
}

interface Run {
  node: Node;
  session: string;
  /** ref → controller id, for the latest look only */
  current: Map<string, string>;
  /** controller id → ref, stable for the run so an element keeps its ref */
  refs: Map<string, string>;
}

const describe = (e: Element) => e.label?.trim() || e.href || e.tag || "";

export function browserPool(nodes: Node[], options: { profile?: string } = {}): Browsers & { reset(): Promise<void> } {
  const profile = options.profile ?? "remuse";
  const free = [...nodes];
  const waiting: { take: (node: Node) => void; signal: AbortSignal | undefined }[] = [];
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
      return { ref, role: e.role ?? e.tag ?? "element", label: describe(e), href: e.href, disabled: e.disabled === true };
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
      await Promise.all(nodes.map(async (n) => Promise.all((await n.controller.live()).map((s) => n.controller.delete(s).catch(() => {})))));
    },
    async open(id, url, signal) {
      const node = await lease(signal);
      try {
        const session = await node.controller
          .create(url, profile)
          .catch(() => node.controller.create(url, null)); // no saved logins yet
        if (signal?.aborted) {
          await node.controller.delete(session).catch(() => {});
          throw new Error("stopped");
        }
        runs.set(id, { node, session, current: new Map(), refs: new Map() });
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
          return act(r, { name: "click", body: { element_id: target(r, step.ref) } });
        case "type": {
          const element_id = target(r, step.ref);
          if (step.text.length > 5000) throw new Error("That text is too long to type at once (5000 characters at most).");
          if (step.text) await act(r, { name: "type", body: { element_id, text: step.text, clear_first: true } });
          else {
            // the controller refuses empty text: clear the field by hand
            await act(r, { name: "click", body: { element_id } });
            await act(r, { name: "press", body: { key: "Control+a" } });
            await act(r, { name: "press", body: { key: "Delete" } });
          }
          if (step.submit) await act(r, { name: "press", body: { key: "Enter" } });
          return;
        }
        case "press":
          return act(r, { name: "press", body: { key: step.key } });
        case "navigate": {
          if (!URL.canParse(step.url) || !/^https?:$/.test(new URL(step.url).protocol)) throw new Error(`"${step.url}" is not an http(s) URL.`);
          return act(r, { name: "navigate", body: { url: new URL(step.url).href } });
        }
        case "scroll":
          return act(r, { name: "scroll", body: { delta_x: 0, delta_y: step.direction === "down" ? 700 : -700 } });
      }
    },
    async screenshot(id) {
      const r = runs.get(id);
      return r ? r.node.controller.screenshot(r.session).catch(() => null) : null;
    },
    async remember(id) {
      const r = run(id);
      await r.node.controller.saveProfile(r.session, profile);
    },
    async close(id) {
      const r = runs.get(id);
      if (!r) return;
      runs.delete(id);
      await r.node.controller.delete(r.session).catch(() => {});
      release(r.node);
    },
    vnc: (id) => runs.get(id)?.node.vnc ?? null,
  };
}
