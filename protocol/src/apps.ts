/**
 * The apps the agent can be connected to (a connector's directory: Composio
 * has well over a thousand), and the accounts already connected. Not part of
 * the conversation: asked for when the user looks, not folded from events.
 */
import { z } from "zod";
import { Id } from "./entities.ts";

export const App = z.object({
  /** the provider's id, as connections and the agent name it (e.g. "gmail") */
  id: Id,
  name: z.string(),
  description: z.string(),
  logo: z.url().nullable(),
});

/** expired: it worked, and needs authorizing again */
export const AccountStatus = z.enum(["active", "expired", "failed"]);

/** One account of an app; an app may have several (two Gmail addresses). `label` tells them apart (an email, a name). */
export const Account = z.object({
  id: Id,
  app: App,
  label: z.string().nullable(),
  status: AccountStatus,
  /** when it was connected (null: not known) */
  since: z.string().nullable(),
});

/**
 * What an app's tool does, as far as the user's safety goes: reads, changes
 * something, or destroys something (deletes, cancels: hard or impossible to undo).
 */
export const ToolKind = z.enum(["read", "write", "destructive"]);

/** What the agent may do with a tool: use it, ask the user first each time, or not even see it. */
export const Permission = z.enum(["allow", "ask", "deny"]);

/** What the agent may do with an app's tools of one kind. `chosen`: the user set it (else it is the kind's default). */
export const KindRule = z.object({ kind: ToolKind, permission: Permission, chosen: z.boolean() });

/** A website, by its host without "www." ("bank.com"); a rule for it covers its subdomains too. */
export const Site = z.string().regex(/^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)$/, "a site is a host name, like bank.com");

/**
 * The kinds of thing the browser does that the user rules on: open a page (also web_read), submit forms or send a POST (the steps
 * with consequences: send, order, apply, post), keep a downloaded file in the workspace, and upload one of theirs.
 */
export const BrowserAction = z.enum(["visit", "submit", "download", "upload"]);

/** What may be done in the browser by one kind of action. `chosen`: the user set it (else it is the action's default). */
export const BrowserRule = z.object({ action: BrowserAction, permission: Permission, chosen: z.boolean() });

/** What a site changes of the global rules, for itself and its subdomains: some actions set (uploads can be asked about or denied, never allowed). */
export const SiteActions = z
  .strictObject({ visit: Permission.optional(), submit: Permission.optional(), download: Permission.optional(), upload: Permission.optional() })
  .refine((actions) => actions.upload !== "allow", "uploads are always asked about");

/** A site's exceptions: never to be visited (which wins over everything), and actions set for it. */
export const SiteEntry = z.object({ never: z.boolean(), actions: SiteActions });

/** The exceptions the user has set for a site (it and its subdomains). */
export const SiteRule = z.object({ site: Site, never: z.boolean(), actions: SiteActions });

export type App = z.infer<typeof App>;
export type BrowserAction = z.infer<typeof BrowserAction>;
export type BrowserRule = z.infer<typeof BrowserRule>;
export type SiteActions = z.infer<typeof SiteActions>;
export type SiteEntry = z.infer<typeof SiteEntry>;
export type SiteRule = z.infer<typeof SiteRule>;
export type ToolKind = z.infer<typeof ToolKind>;
export type Permission = z.infer<typeof Permission>;
export type KindRule = z.infer<typeof KindRule>;
export type Account = z.infer<typeof Account>;
export type AccountStatus = z.infer<typeof AccountStatus>;
