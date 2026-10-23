/**
 * What migration 1 knows of the old files, frozen as it was at 0.1.0. A migration reads the world as it was when it was
 * written, so none of this imports the live protocol or core: a later release can change those schemas and defaults
 * without changing what an old instance imports. Do not edit these to follow them; a later migration that needs a new
 * shape has its own.
 */
import { z } from "zod";

export const MAIN = "main";

export const Id = z.string().min(1);
export const Instant = z.iso.datetime();

export const Chat = z.object({ id: Id, title: z.string().max(80), at: Instant, updated: Instant });
export type Chat = z.infer<typeof Chat>;

export const Attachment = z.object({
  id: Id,
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  size: z.int().nonnegative(),
  path: z.string().min(1).max(1024),
});

export const ToolKind = z.enum(["read", "write", "destructive"]);
export const Permission = z.enum(["allow", "ask", "deny"]);
export type Permission = z.infer<typeof Permission>;
export const BrowserAction = z.enum(["visit", "submit", "download", "upload"]);
export type BrowserAction = z.infer<typeof BrowserAction>;
export const Site = z.string().regex(/^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)$/, "a site is a host name, like bank.com");

export type SiteActions = { [A in BrowserAction]?: Permission | undefined };
export interface SiteEntry {
  never: boolean;
  actions: SiteActions;
}
export type AppRules = { [K in z.infer<typeof ToolKind>]?: Permission | undefined };
export interface AllRules {
  apps: Record<string, AppRules>;
  browser: SiteActions;
  sites: Record<string, SiteEntry>;
}
export const noRules: AllRules = { apps: {}, browser: {}, sites: {} };

/** What the browser did before the user chose, as 0.1.0 had it. */
export const defaultBrowser: Readonly<Record<BrowserAction, Permission>> = { visit: "ask", submit: "ask", download: "allow", upload: "ask" };

/**
 * An event line as the journal held it, by its shape only: a numbered event of one of the three kinds, with the entity at
 * least naming its kind and id. Whatever else it holds is kept as it is, unread: the live schema reads it at replay, so a
 * field this copy does not know is never dropped by the import.
 */
export const Envelope = z.looseObject({
  seq: z.int().positive(),
  event: z.discriminatedUnion("kind", [
    z.looseObject({ kind: z.literal("upserted"), index: z.int().nonnegative(), entity: z.looseObject({ kind: z.string(), id: Id }) }),
    z.looseObject({ kind: z.literal("appended"), id: Id, text: z.string() }),
    z.looseObject({ kind: z.literal("activity"), activity: z.looseObject({ kind: z.string() }).nullable() }),
  ]),
});
