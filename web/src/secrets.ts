/**
 * The Vault as the page works with it: a value while it is typed or chosen, files read into base64 (what a request
 * card can ask for, and what old entries hold), the uses of an entry in words, and the clipboard. No React here.
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

/** The assistant's name, for "Amuse's computer" (it follows the assistant's name once that can be changed). */
const ASSISTANT = "Amuse";

/** Where an entry is used, in one line: "OpenAI models", "Amuse's computer: $GH_TOKEN", or that it is not used yet. */
export function usesSummary(entry: SecretEntry, names: ProviderNames, t: Messages): string {
  if (entry.uses.length === 0) return t.secrets.notUsed;
  const ofComputer = entry.uses.filter((use) => use.kind !== "server").map((use) => describeUse(use, names, t));
  const ofServer = entry.uses.filter((use) => use.kind === "server").map((use) => describeUse(use, names, t));
  const lines = ofComputer.length > 0 ? [t.secrets.onComputer(ofComputer.join(", "), t.computer(ASSISTANT)), ...ofServer] : ofServer;
  return lines.join(" · ");
}

/** A use as a sentence on the entry's page. */
export function useSentence(use: SecretEntry["uses"][number], names: ProviderNames, t: Messages): string {
  const computer = t.computer(ASSISTANT);
  if (use.kind === "env") return t.secrets.usedEnv(use.name, computer);
  if (use.kind === "file") {
    const path = t.secrets.usedFile(homePath(use.path), computer);
    return use.env ? `${path}, ${t.secrets.usedFileEnv(use.env)}` : path;
  }
  return describeUse(use, names, t);
}

/** What a field is called on a page: its role in words ("Username"), or its name as it was given. */
export function labelOf(name: string, role: PlainRole | SecretRole | null, t: Messages): string {
  if (role === "username") return t.secrets.username;
  if (role === "password") return t.secrets.password;
  if (name === "key") return t.secrets.apiKey;
  if (name === "secret") return t.secrets.secret;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The computer's name as the Vault says it. */
export const computerName = (t: Messages) => t.computer(ASSISTANT);

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

/* ---------- new entries ---------- */

export type Kind = "key" | "login" | "custom";

export const KINDS: Kind[] = ["key", "login", "custom"];

/** A secret as typed: one line is text; several lines (a pasted service account) are kept whole, as a file the page never calls one. */
export function typedSecret(text: string, name: string): FieldValue | null {
  return /[\r\n]/.test(text.trim()) ? toValue(pasted(text, name), name) : toValue({ kind: "text", text: text.trim() }, name);
}

/** The text a stored value stands for (a file's bytes read as text), or null when they are not text. */
export function valueText(value: FieldValue): string | null {
  if (value.kind === "text") return value.text;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.content), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/* ---------- reveal and copy ---------- */

/** A revealed secret hides again after this long; a copied one is taken off the clipboard after the next. */
export const REVEAL_MS = 30_000;
export const CLIPBOARD_MS = 60_000;

/** Copy a value; with `clearAfter`, empty the clipboard then if it still holds that value (where the browser lets a page look). */
export async function copy(value: string, clearAfter: number | null): Promise<void> {
  await navigator.clipboard.writeText(value);
  if (clearAfter === null) return;
  setTimeout(() => {
    navigator.clipboard.readText().then(
      (now) => (now === value ? navigator.clipboard.writeText("") : undefined),
      () => undefined,
    );
  }, clearAfter);
}
