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

export type App = z.infer<typeof App>;
export type Account = z.infer<typeof Account>;
export type AccountStatus = z.infer<typeof AccountStatus>;
