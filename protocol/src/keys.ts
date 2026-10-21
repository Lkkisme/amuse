/**
 * The user's own keys: the providers whose models Muse runs on (and Composio,
 * for apps), set up in the app by API key, and the models chosen for the chat
 * and for the browser. A key never comes back: a provider set up shows only
 * the end of it. Signing in is a short exchange the provider leads (its key,
 * sometimes an account id or a region), one prompt at a time.
 */
import { z } from "zod";

/** What a provider's key is for: Muse's models, or the apps it connects (Composio). */
export const KeyUse = z.enum(["models", "apps"]);
export type KeyUse = z.infer<typeof KeyUse>;

export const KeyProvider = z.object({
  id: z.string().min(1).max(100),
  name: z.string(),
  use: KeyUse,
  connected: z.boolean(),
  /** the end of the key set up ("…a1b2"), when there is one to show */
  hint: z.string().nullable(),
});
export type KeyProvider = z.infer<typeof KeyProvider>;

/** "provider/model-id", the way a model is chosen */
export const ModelRef = z.string().min(3).max(300);

export const ModelOption = z.object({
  id: ModelRef,
  name: z.string(),
  provider: z.string(),
  /** it sees pictures (the browser's model must) */
  images: z.boolean(),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const ModelRole = z.enum(["chat", "browser"]);
export type ModelRole = z.infer<typeof ModelRole>;

export const LoginPrompt = z.object({
  /** secret: typed unseen (a key); select: one of `options` */
  type: z.enum(["text", "secret", "select"]),
  message: z.string(),
  placeholder: z.string().nullable(),
  options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().nullable() })),
});
export type LoginPrompt = z.infer<typeof LoginPrompt>;

/** Something the provider says along the way, with links to follow (where to get a key). */
export const LoginNote = z.object({
  message: z.string(),
  links: z.array(z.object({ url: z.url(), label: z.string().nullable() })),
});
export type LoginNote = z.infer<typeof LoginNote>;

/** Where a sign-in stands: a prompt to answer (by its `login` id), done, or failed. */
export const LoginStep = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt"), login: z.string(), prompt: LoginPrompt, notes: z.array(LoginNote) }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("failed"), reason: z.string() }),
]);
export type LoginStep = z.infer<typeof LoginStep>;

export const KeysState = z.object({
  providers: z.array(KeyProvider),
  /** the models the providers set up offer */
  models: z.array(ModelOption),
  chat: ModelRef.nullable(),
  browser: ModelRef.nullable(),
});
export type KeysState = z.infer<typeof KeysState>;
