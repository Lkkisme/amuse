/**
 * The Vault as the page works with it: a field's value while it is typed or chosen, files read into base64,
 * the uses of an entry in words, which list an entry is in, and what a new entry can start from. No React here.
 */
import {
  EnvName,
  type FieldKind,
  type FieldValue,
  MAX_FILE,
  MAX_TEXT,
  type PlainRole,
  type SecretEntry,
  type SecretRole,
  type UseInput,
  fileSize,
} from "@amuse/protocol";
import type { Messages } from "./i18n/en.ts";

/* ---------- values ---------- */

/** A value being filled in: a line of text, or a file (a pasted one has no name until it is given one: the field's). */
export type Draft = { kind: "text"; text: string } | { kind: "file"; filename: string; content: string };

export function blank(kind: FieldKind): Draft {
  return kind === "text" ? { kind, text: "" } : { kind, filename: "", content: "" };
}

export function fromValue(value: FieldValue): Draft {
  return value.kind === "text"
    ? { kind: "text", text: value.text }
    : { kind: "file", filename: value.filename, content: value.content };
}

/** The value a draft stands for, or null while it is not one: empty, too long, or a file too big. `fallback` names a pasted file. */
export function toValue(draft: Draft, fallback: string): FieldValue | null {
  if (draft.kind === "text") {
    const { text } = draft;
    return text === "" || text.length > MAX_TEXT || /[\r\n]/.test(text) ? null : { kind: "text", text };
  }
  const filename = draft.filename.trim() || fallback.trim();
  if (filename === "" || draft.content === "" || fileSize(draft.content) > MAX_FILE) return null;
  return { kind: "file", filename, content: draft.content };
}

/** The end of a text secret, as shown: "…a1b2" (a hint that already has its dots keeps them). */
export function hintText(hint: string): string {
  return hint.startsWith("…") ? hint : `…${hint}`;
}

/** What a file is worth in bytes, in words: "812 B", "2.4 KB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(Math.round((bytes / 1024) * 10) / 10).toString()} KB`;
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Text as the UTF-8 file it would be, in base64. */
export function encodeText(text: string): string {
  return text === "" ? "" : encodeBytes(new TextEncoder().encode(text));
}

/** A file chosen, as a draft; or why it is not one. */
export async function readFile(file: File): Promise<Draft | "tooBig" | "empty" | "unreadable"> {
  if (file.size > MAX_FILE) return "tooBig";
  if (file.size === 0) return "empty";
  try {
    const content = encodeBytes(new Uint8Array(await file.arrayBuffer()));
    return { kind: "file", filename: file.name, content };
  } catch {
    return "unreadable";
  }
}

/** A text pasted for a file: its name is blank until the user gives it one. */
export function pasted(text: string, filename: string): Draft {
  return { kind: "file", filename, content: encodeText(text) };
}

/** What stops a draft from being a value: a file over the limit says so, so the user is told and not only held back. */
export function tooBig(draft: Draft): boolean {
  return draft.kind === "file" && fileSize(draft.content) > MAX_FILE;
}

export const FILE_KB = MAX_FILE / 1024;

/* ---------- a form's problems ---------- */

export type Problem = "name" | "fieldName" | "twice" | "value";

/**
 * What keeps an entry from being saved as filled in, if anything. A secret field's `draft` is null when it keeps its
 * value (an entry being edited), which is not asked for.
 */
export function problem(entry: {
  name: string;
  plain: { name: string; draft: Draft }[];
  secret: { name: string; draft: Draft | null }[];
}): Problem | null {
  if (entry.name.trim() === "") return "name";
  const names = [...entry.plain, ...entry.secret].map((field) => field.name.trim());
  if (names.some((name) => name === "")) return "fieldName";
  if (new Set(names).size !== names.length) return "twice";
  const values = [
    ...entry.plain.map((field) => toValue(field.draft, field.name)),
    ...entry.secret.flatMap((field) => (field.draft ? [toValue(field.draft, field.name)] : [])),
  ];
  return values.some((value) => value === null) ? "value" : null;
}

/* ---------- uses ---------- */

/** A use as it is made in Settings, before it is tied to a field. */
export type UseSpec = { kind: "env"; name: string } | { kind: "file"; path: string; env: string | null };

/** A path in the sandbox's home folder, as it is kept: "~/.config/x" and "/.config/x" are ".config/x". */
export function homePath(path: string): string {
  return path.trim().replace(/^~?\/+/, "");
}

export function validEnv(name: string): boolean {
  return EnvName.safeParse(name).success;
}

export function validPath(path: string): boolean {
  const home = homePath(path);
  return home.length > 0 && home.length <= 1024;
}

/** The use for a field. */
export function useOf(field: string, spec: UseSpec): UseInput {
  return spec.kind === "env"
    ? { kind: "env", field, name: spec.name }
    : { kind: "file", field, path: homePath(spec.path), env: spec.env };
}

export function describeSpec(spec: UseSpec, t: Messages): string {
  if (spec.kind === "env") return t.secrets.env(spec.name);
  const path = homePath(spec.path);
  return spec.env ? t.secrets.atPathWithEnv(path, spec.env) : t.secrets.atPath(path);
}

/** Providers' names by id (a use of the server's names its provider by id). */
export type ProviderNames = ReadonlyMap<string, string>;

/** A use in words: "$CF_API_TOKEN", "file .config/x/key.json", "OpenAI models". */
export function describeUse(use: UseInput, names: ProviderNames, t: Messages): string {
  if (use.kind !== "server") return describeSpec(use, t);
  const provider = names.get(use.target) ?? use.target;
  if (use.service === "model") return t.secrets.forModels(provider);
  if (use.service === "voice") return t.secrets.forVoice(provider);
  return t.secrets.forApps(provider);
}

/** All of an entry's uses in one line, or that it has none. */
export function usesSummary(entry: SecretEntry, names: ProviderNames, t: Messages): string {
  if (entry.uses.length === 0) return t.secrets.notUsed;
  return entry.uses.map((use) => describeUse(use, names, t)).join(", ");
}

export type Group = "sandbox" | "server" | "none";

/** Which list an entry is in: used in the sandbox (even if also by the server), only by the server's own services, or not used. */
export function groupOf(entry: SecretEntry): Group {
  if (entry.uses.some((use) => use.kind !== "server")) return "sandbox";
  return entry.uses.length > 0 ? "server" : "none";
}

/** Does an entry match what was searched for: in its name, its fields' names or its uses. */
export function matches(entry: SecretEntry, query: string, names: ProviderNames, t: Messages): boolean {
  const words = query.trim().toLowerCase();
  if (words === "") return true;
  const haystack = [
    entry.name,
    ...entry.plain.map((field) => field.name),
    ...entry.secret.map((field) => field.name),
    ...entry.uses.map((use) => describeUse(use, names, t)),
  ];
  return haystack.some((text) => text.toLowerCase().includes(words));
}

/* ---------- presets ---------- */

export type PresetId = "key" | "login" | "file" | "blank";

export interface Preset {
  id: PresetId;
  plain: { name: string; role: PlainRole | null; kind: FieldKind }[];
  secret: { name: string; role: SecretRole | null; kind: FieldKind }[];
  /** uses suggested, on the field of that name */
  uses: { field: string; spec: UseSpec }[];
}

/** What a new entry can start from. The field names are what Amuse reads, so they are not translated. */
export const PRESETS: Preset[] = [
  { id: "key", plain: [], secret: [{ name: "key", role: null, kind: "text" }], uses: [] },
  {
    id: "login",
    plain: [{ name: "username", role: "username", kind: "text" }],
    secret: [{ name: "password", role: "password", kind: "text" }],
    uses: [],
  },
  {
    id: "file",
    plain: [],
    secret: [{ name: "key.json", role: null, kind: "file" }],
    uses: [
      {
        field: "key.json",
        spec: { kind: "file", path: ".config/gcloud/key.json", env: "GOOGLE_APPLICATION_CREDENTIALS" },
      },
    ],
  },
  { id: "blank", plain: [], secret: [{ name: "", role: null, kind: "text" }], uses: [] },
];
