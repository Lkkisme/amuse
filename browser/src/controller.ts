/**
 * One auto-browser controller, over its REST API: only the calls amuse
 * makes, every response parsed with zod at the boundary. The controller's
 * element ids (op-…) never leave the browser package.
 */
import { z } from "zod";

export class ControllerError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

const Session = z.object({ id: z.string().regex(/^[\w-]+$/), status: z.string(), live: z.boolean() });

export const Element = z.object({
  element_id: z.string(),
  tag: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  type: z.string().nullable().default(null),
  href: z.string().nullable().default(null),
  disabled: z.boolean().nullable().default(null),
  checked: z.boolean().nullable().default(null),
});
export type Element = z.infer<typeof Element>;

export const Observation = z.object({
  url: z.string(),
  title: z.string().default(""),
  text_excerpt: z.string().nullable().default(null),
  interactables: z.array(Element).default([]),
});
export type Observation = z.infer<typeof Observation>;

const Acted = z.object({ before: z.object({ url: z.string() }).loose().nullable().default(null), after: Observation.loose().nullable().default(null) });
const Shot = z.object({ screenshot_url: z.string().startsWith("/artifacts/") });

export type Action =
  | { name: "navigate"; body: { url: string } }
  | { name: "click"; body: { element_id: string } }
  | { name: "type"; body: { element_id: string; text: string; clear_first: boolean } }
  | { name: "press"; body: { key: string } }
  | { name: "scroll"; body: { delta_x: number; delta_y: number } }
  /** a file already in the controller's upload folder, into a file input (amuse approves uploads itself) */
  | { name: "upload"; body: { element_id: string; file_path: string; approved: boolean } };

/** A file the page downloaded, kept by the controller. */
export const Download = z.object({
  filename: z.string(),
  status: z.string(),
  url: z.string().startsWith("/artifacts/"),
});
export type Download = z.infer<typeof Download>;

export interface Controller {
  create(startUrl: string, profile: string | null): Promise<string>;
  observe(session: string): Promise<Observation>;
  /** Runs an action; the URL before and after (actions can navigate). */
  act(session: string, action: Action): Promise<{ before: string | null; after: Observation | null }>;
  screenshot(session: string): Promise<Uint8Array>;
  saveProfile(session: string, profile: string): Promise<void>;
  delete(session: string): Promise<void>;
  /** Ids of sessions the controller still has live (left over from a crash, say). */
  live(): Promise<string[]>;
  /** What the session's pages have downloaded so far. */
  downloads(session: string): Promise<Download[]>;
  /** How many tabs the session has open (none: the user closed its window). */
  tabs(session: string): Promise<number>;
  /** A downloaded file's bytes, by its /artifacts/ url. */
  artifact(url: string): Promise<Uint8Array>;
}

export function controller(base: string, token: string, http: typeof fetch = fetch): Controller {
  async function request(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await http(new URL(path, base), {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (Number(response.headers.get("retry-after")) || 1)));
        continue;
      }
      if (!response.ok) throw new ControllerError(`${method} ${path.split("?")[0]} failed (${response.status})`, response.status);
      return response;
    }
  }
  async function json<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const parsed = schema.safeParse(await (await request(method, path, body, timeoutMs)).json());
    if (!parsed.success) throw new ControllerError(`${path.split("?")[0]} returned an unexpected shape`);
    return parsed.data;
  }

  return {
    async create(startUrl, profile) {
      const body = { name: "amuse", start_url: startUrl, ...(profile ? { auth_profile: profile } : {}) };
      return (await json(Session, "POST", "/sessions", body, 90_000)).id;
    },
    observe: (session) => json(Observation, "POST", `/sessions/${session}/observe`, { preset: "normal", limit: 120 }),
    async act(session, { name, body }) {
      const result = await json(Acted, "POST", `/sessions/${session}/actions/${name}`, body, 90_000);
      return { before: result.before?.url ?? null, after: result.after };
    },
    async screenshot(session) {
      const { screenshot_url } = await json(Shot, "POST", `/sessions/${session}/screenshot`, { label: "thumb" });
      return new Uint8Array(await (await request("GET", screenshot_url)).arrayBuffer());
    },
    async saveProfile(session, profile) {
      await request("POST", `/sessions/${session}/auth-profiles`, { profile_name: profile });
    },
    async delete(session) {
      await request("DELETE", `/sessions/${session}`);
    },
    async live() {
      return (await json(z.array(Session), "GET", "/sessions")).filter((s) => s.live).map((s) => s.id);
    },
    downloads: (session) => json(z.array(Download.loose()), "GET", `/sessions/${session}/downloads`),
    tabs: async (session) => (await json(z.array(z.object({ index: z.int() }).loose()), "GET", `/sessions/${session}/tabs`)).length,
    async artifact(url) {
      if (!url.startsWith("/artifacts/")) throw new ControllerError("not an artifact");
      return new Uint8Array(await (await request("GET", url, undefined, 120_000)).arrayBuffer());
    },
  };
}
