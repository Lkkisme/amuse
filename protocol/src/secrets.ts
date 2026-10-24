/**
 * The Vault: the long-lived secrets Amuse keeps for the user, apart from where they are used.
 *
 * An entry has, in this order, a name, plain fields (an account id, a username, a region: seen by Amuse and
 * in Settings, and edited there), secret fields (a token, a password, a key file: kept encrypted, never shown
 * back, replaced and never read) and a note. Which list a field is in decides how it is treated; a field has no
 * level of its own. A field holds a line of text or a file (a service account's JSON, a keystore).
 *
 * Uses say where a field goes: into the sandbox (an environment variable, a file), or to a service of the
 * server's own (a model provider, a speech service, Composio), which neither Amuse nor the sandbox ever sees.
 * Whoever needs a value asks for it by its use, never by the entry's id. The list of uses is open: browser
 * logins and MCP servers come later.
 *
 * This file stands alone (entities.ts builds on it, for the card that asks for a secret).
 */
import { z } from "zod";

/** A file field holds at most this many bytes. */
export const MAX_FILE = 64 * 1024;
/** The longest a line of text a field holds can be. */
export const MAX_TEXT = 20_000;

/** An environment variable's name as the sandbox takes it. */
export const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/);

/** A field's name, as the user and Amuse call it ("token", "username", "key.json"). */
export const FieldName = z.string().trim().min(1).max(60);

/** A plain field may stand for the login's username; a secret one for its password. Only stored, for now. */
export const PlainRole = z.enum(["username"]);
export const SecretRole = z.enum(["password"]);
export type PlainRole = z.infer<typeof PlainRole>;
export type SecretRole = z.infer<typeof SecretRole>;

export const FieldKind = z.enum(["text", "file"]);
export type FieldKind = z.infer<typeof FieldKind>;

/** What base64 of a file of `MAX_FILE` bytes comes to at most. */
const MAX_BASE64 = Math.ceil(MAX_FILE / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The bytes a base64 text stands for. */
export function fileSize(content: string): number {
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  return Math.floor((content.length * 3) / 4) - padding;
}

/** A value as it is given: one line of text, or a file (its name, and its bytes in base64; at most `MAX_FILE`). */
export const FieldValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(MAX_TEXT).refine((text) => !/[\r\n]/.test(text), "A line of text has no line breaks: use a file for more.") }),
  z.object({
    kind: z.literal("file"),
    filename: z.string().min(1).max(255),
    content: z.string().min(1).max(MAX_BASE64).regex(BASE64, "A file's content is base64.").refine((content) => fileSize(content) <= MAX_FILE, `A file is at most ${MAX_FILE / 1024} KB.`),
  }),
]);
export type FieldValue = z.infer<typeof FieldValue>;

/** A plain field to set: its name, its value, and its role if it has one. */
export const PlainInput = z.object({ name: FieldName, role: PlainRole.nullable().default(null), value: FieldValue });
export type PlainInput = z.infer<typeof PlainInput>;

/** A secret field to set (or replace): its name, its value, and its role if it has one. */
export const SecretInput = z.object({ name: FieldName, role: SecretRole.nullable().default(null), value: FieldValue });
export type SecretInput = z.infer<typeof SecretInput>;

/** Where a field was last used: when, and how ("sandbox": delivered to it; "server": used by the server for a service), and as what. */
export const LastUsed = z.object({ at: z.iso.datetime(), how: z.enum(["sandbox", "server"]), what: z.string() });
export type LastUsed = z.infer<typeof LastUsed>;

/** A plain field as it is listed: its value is there to see. */
export const PlainField = z.object({ name: FieldName, role: PlainRole.nullable(), value: FieldValue });
export type PlainField = z.infer<typeof PlainField>;

/**
 * A secret field as it is listed: never its value. `hint` is the end of a line of text ("…a1b2"; none for a file or
 * a short one); `filename` and `size` (bytes) tell a file.
 */
export const SecretField = z.object({
  name: FieldName,
  role: SecretRole.nullable(),
  kind: FieldKind,
  filename: z.string().nullable(),
  size: z.int().min(0),
  hint: z.string().nullable(),
  last: LastUsed.nullable(),
});
export type SecretField = z.infer<typeof SecretField>;

/** What a server-side use is for. */
export const ServerService = z.enum(["model", "voice", "apps"]);
export type ServerService = z.infer<typeof ServerService>;

const env = z.object({ kind: z.literal("env"), field: FieldName, name: EnvName });
/** A file in the sandbox's home folder; `env`: a variable set to the file's path too (the path is not secret). */
const file = z.object({ kind: z.literal("file"), field: FieldName, path: z.string().min(1).max(1024), env: EnvName.nullable().default(null) });
/** `target`: the provider's id for a model or a voice service ("openai", "local"), or the apps' ("composio"). */
const server = z.object({ kind: z.literal("server"), field: FieldName, service: ServerService, target: z.string().min(1).max(100) });

/** A use to add. */
export const UseInput = z.discriminatedUnion("kind", [env, file, server]);
export type UseInput = z.infer<typeof UseInput>;

const id = z.string().min(1);

/** A use of an entry's field, with the id to take it back by. */
export const Use = z.discriminatedUnion("kind", [env.extend({ id }), file.extend({ id }), server.extend({ id })]);
export type Use = z.infer<typeof Use>;

export const SecretEntry = z.object({
  id,
  name: z.string(),
  /** kept by the system (a provider's sign-in, which it refreshes): its fields and uses are not the user's to edit, only to remove, which signs out */
  managed: z.boolean(),
  plain: z.array(PlainField),
  secret: z.array(SecretField),
  note: z.string(),
  uses: z.array(Use),
  created: z.iso.datetime(),
});
export type SecretEntry = z.infer<typeof SecretEntry>;

/** A plain field of a request, with its value: Amuse supplies these (it knows them, or has asked in the chat). The user types none of them. */
const AskedPlain = z.object({ name: FieldName, role: PlainRole.nullable().default(null), value: FieldValue });
/** A secret field asked for: its name, and whether it is a line or a file; the user types it. */
const AskedSecret = z.object({ name: FieldName, kind: FieldKind.default("text"), role: SecretRole.nullable().default(null) });
export type AskedPlain = z.infer<typeof AskedPlain>;
export type AskedSecret = z.infer<typeof AskedSecret>;

/** The sandbox variable or file of an old request, read as the long-term secret it would be now. */
const OLD_FIELD = "key";

/**
 * What a card asks the user for.
 *   temporary  a code a program waits for (a login, a verification or an OAuth code): typed into that terminal, kept
 *              nowhere, listed nowhere, and gone when it expires
 *   stored     a long-term secret: the user types the secret fields it names, and it is kept in the Vault with the plain
 *              fields Amuse filled in (shown on the card, read-only) and the uses written here (typing the secrets in is
 *              the user's word for them). Everything the user types on a card is a secret: a card has no plain field to type in.
 *   key        the key of a service of the server's (a model provider, Composio; `provider` is its id in the keys): added
 *              with the same sign-in sheet as in Settings, so no value passes through the card; `hint` is the end of the
 *              key, once it is there
 * A request from before this was one variable, one file or one terminal; it reads as the same thing.
 */
export const SecretAsk = z.preprocess(
  (raw) => {
    if (typeof raw !== "object" || raw === null || !("kind" in raw)) return raw;
    if (raw.kind === "stdin") {
      const pane = "pane" in raw ? raw.pane : "service" in raw ? raw.service : undefined;
      return { kind: "temporary", pane };
    }
    const stored = { kind: "stored", plain: [], secret: [{ name: OLD_FIELD }], note: "" };
    if (raw.kind === "env" && "name" in raw) return { ...stored, uses: [{ kind: "env", field: OLD_FIELD, name: raw.name }] };
    if (raw.kind === "file" && "path" in raw) return { ...stored, uses: [{ kind: "file", field: OLD_FIELD, path: raw.path }] };
    return raw;
  },
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("temporary"), pane: z.string().min(1).max(60) }),
    z.object({ kind: z.literal("key"), provider: z.string().min(1).max(100), hint: z.string().nullable().default(null) }),
    z.object({
      kind: z.literal("stored"),
      plain: z.array(AskedPlain).max(20),
      secret: z.array(AskedSecret).min(1).max(20),
      note: z.string().max(2000),
      uses: z.array(UseInput).max(20),
    }),
  ]),
);
export type SecretAsk = z.infer<typeof SecretAsk>;

/** The user's answer to a card: the code, or the values of the secret fields it asked for (and nothing else: a plain value is not the user's to type here, so one is refused). */
export const SecretAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("temporary"), value: z.string().min(1).max(MAX_TEXT) }),
  z.strictObject({
    kind: z.literal("stored"),
    secret: z.array(z.object({ name: FieldName, value: FieldValue })),
  }),
]);
export type SecretAnswer = z.infer<typeof SecretAnswer>;
