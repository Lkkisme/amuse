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

/** How much a model thinks before it answers (Pi's levels; a model takes only some). */
export const ThinkingLevel = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ThinkingLevel = z.infer<typeof ThinkingLevel>;

export const ModelOption = z.object({
  id: ModelRef,
  name: z.string(),
  provider: z.string(),
  /** it sees pictures (the browser's model must) */
  images: z.boolean(),
  /** the thinking levels it takes (only "off" for a model that does not think) */
  thinking: z.array(ThinkingLevel),
});
export type ModelOption = z.infer<typeof ModelOption>;

/** chat: Amuse in the chat; browser: its browser agent; background: scheduled work (both on the chat's model when none is chosen) */
export const ModelRole = z.enum(["chat", "browser", "background"]);
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

/** How a key's test went: it works, or why not (in the provider's words). */
export const KeyTest = z.object({ ok: z.boolean(), detail: z.string() });
export type KeyTest = z.infer<typeof KeyTest>;

/** A speech-to-text server the user runs (an OpenAI-style /audio/transcriptions): where, and which model. */
export const LocalVoice = z.object({ url: z.url(), model: z.string().min(1).max(200) });
export type LocalVoice = z.infer<typeof LocalVoice>;

export const KeysState = z.object({
  providers: z.array(KeyProvider),
  /** the models the providers set up offer */
  models: z.array(ModelOption),
  chat: ModelRef.nullable(),
  /** null: the browser runs on the chat's model (when that one sees pictures) */
  browser: ModelRef.nullable(),
  /** null: scheduled work runs on the chat's model */
  background: ModelRef.nullable(),
  /** how much each thinks */
  thinking: z.object({ chat: ThinkingLevel, browser: ThinkingLevel, background: ThinkingLevel }),
  /** speech to text for the mic: the services the user has a key for, and the one chosen (null: the first of them) */
  voice: z.object({
    services: z.array(z.object({ provider: z.string(), name: z.string() })),
    chosen: z.string().nullable(),
    /** a speech service the user runs themselves (provider "local"), when set up */
    local: LocalVoice.nullable(),
  }),
});
export type KeysState = z.infer<typeof KeysState>;
