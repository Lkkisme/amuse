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
export const Account = z.object({ id: Id, app: App, label: z.string().nullable(), status: AccountStatus });

/**
 * What an app's tool does, as far as the user's safety goes: reads, changes
 * something, or destroys something (deletes, cancels: hard or impossible to undo).
 */
export const ToolKind = z.enum(["read", "write", "destructive"]);

/** What the agent may do with a tool: use it, ask the user first each time, or not even see it. */
export const Permission = z.enum(["allow", "ask", "deny"]);

/** What the agent may do with an app's tools of one kind. `chosen`: the user set it (else it is the kind's default). */
export const KindRule = z.object({ kind: ToolKind, permission: Permission, chosen: z.boolean() });

export type App = z.infer<typeof App>;
export type ToolKind = z.infer<typeof ToolKind>;
export type Permission = z.infer<typeof Permission>;
export type KindRule = z.infer<typeof KindRule>;
export type Account = z.infer<typeof Account>;
export type AccountStatus = z.infer<typeof AccountStatus>;
