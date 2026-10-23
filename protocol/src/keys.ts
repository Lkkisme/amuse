/**
 * The user's own keys: the providers whose models Muse runs on (and Composio,
 * for apps), set up in the app by API key or by signing in with the user's
 * account there, and the models chosen for the chat and for the browser. A key
 * or token never comes back: a provider set up shows only the end of its key.
 * Signing in is a short exchange the provider leads (its key, sometimes an
 * account id or a region; or its sign-in page, then a code), a step at a time.
 */
import { z } from "zod";

/** What a provider's key is for: Muse's models, or the apps it connects (Composio). */
export const KeyUse = z.enum(["models", "apps"]);
export type KeyUse = z.infer<typeof KeyUse>;

/** How a provider is set up: with an API key, or by signing in with the user's account there. */
export const KeyWay = z.enum(["key", "account"]);
export type KeyWay = z.infer<typeof KeyWay>;

/** Why getting a provider's key takes more than creating one (the app has the words for each). */
export const GuideNote = z.enum(["prepaid", "china", "region", "subscription", "complex"]);
export type GuideNote = z.infer<typeof GuideNote>;

/** Where to get a provider's key: the site to sign in at, the page where keys are made, its own guide. */
export const KeyGuide = z.object({
  home: z.url(),
  keys: z.url(),
  docs: z.url().nullable(),
  note: GuideNote.nullable(),
});
export type KeyGuide = z.infer<typeof KeyGuide>;

export const KeyProvider = z.object({
  id: z.string().min(1).max(100),
  name: z.string(),
  use: KeyUse,
  connected: z.boolean(),
  /** how it is set up, when it is */
  way: KeyWay.nullable(),
  /** the end of the key set up ("…a1b2"), when there is one to show (never for a sign-in) */
  hint: z.string().nullable(),
  /** signing in with the user's account, when the provider offers it besides a key; `subscription`: it runs on a consumer plan (ChatGPT, Claude) */
  account: z.object({ name: z.string(), subscription: z.boolean() }).nullable(),
  /** where to get its key, when known */
  guide: KeyGuide.nullable(),
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
  /** secret: typed unseen (a key); select: one of `options`; code: a code the provider's page shows; address: the full address of the page the sign-in ends on (one that does not load) */
  type: z.enum(["text", "secret", "select", "code", "address"]),
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

/** A code to enter on the provider's page, and until when it works. */
export const DeviceCode = z.object({ code: z.string(), url: z.url(), expires: z.iso.datetime().nullable() });
export type DeviceCode = z.infer<typeof DeviceCode>;

/**
 * Where a sign-in stands: a prompt to answer (by its `login` id), waiting for
 * the user to finish on the provider's page (asked again with keys.wait), done,
 * or failed. `page` is the provider's sign-in page to open; `device`, a code to
 * enter there.
 */
export const LoginStep = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt"), login: z.string(), prompt: LoginPrompt, notes: z.array(LoginNote), page: z.url().nullable(), device: DeviceCode.nullable() }),
  z.object({ kind: z.literal("wait"), login: z.string(), notes: z.array(LoginNote), page: z.url().nullable(), device: DeviceCode.nullable() }),
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
