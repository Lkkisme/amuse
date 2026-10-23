/**
 * The Vault's rules, with no IO (the protocol's secrets.ts says what an entry is): which use may be added
 * to which field, whether it needs the user's word, what to mask once a value is in the sandbox, and whether an
 * answer fits the card it answers. The store that keeps the entries, encrypted, is the server's (api/).
 */
import { type SecretAnswer, type SecretAsk, type SecretEntry, type SecretRequest, type SecretField, type ServerService, type Use, type UseInput, fileSize } from "@amuse/protocol";

/** The sandbox's home folder, where a credential file with a relative path lands. */
export const SANDBOX_HOME = "/home/amuse";

/** The folder in the sandbox's home that is shared with Amuse, where a credential file does not go. */
const WORKSPACE = "workspace";

/** The most characters an environment variable holds in the sandbox. */
export const MAX_ENV = 20_000;

/** A value to mask in what the sandbox says to the agent, by the name it is shown by. */
export interface Masking {
  name: string;
  value: string;
}

/** A field of an entry, wherever it is kept. */
export type Located = { side: "plain"; field: SecretEntry["plain"][number] } | { side: "secret"; field: SecretField };

/** Whether a field holds a line of text or a file. */
export const fieldKind = (found: Located): "text" | "file" => (found.side === "plain" ? found.field.value.kind : found.field.kind);

export function locate(entry: SecretEntry, name: string): Located | undefined {
  const plain = entry.plain.find((f) => f.name === name);
  if (plain) return { side: "plain", field: plain };
  const secret = entry.secret.find((f) => f.name === name);
  return secret && { side: "secret", field: secret };
}

/** Whether a use puts the field in the sandbox, where what runs there can read it. */
export const inSandbox = (use: Pick<Use, "kind">): boolean => use.kind === "env" || use.kind === "file";

/** The same entry name, or field name, however it is cased. */
export const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A path as the sandbox keeps a credential file: in its home, without `~/` or the home folder before it; null for what the
 * sandbox's daemon refuses, in every way it can be written: out of home (an absolute path elsewhere, `..` anywhere), the home
 * folder itself, and the workspace (`workspace`, which the user and Amuse's own tools read), however it is spelled.
 */
export function pathInHome(path: string, home: string): string | null {
  const trimmed = path.trim();
  if (trimmed.includes("\0")) return null;
  let inside: string;
  if (trimmed === "~" || trimmed === home) return null;
  if (trimmed.startsWith("~/")) inside = trimmed.slice(2);
  else if (trimmed.startsWith(`${home}/`)) inside = trimmed.slice(home.length + 1);
  else if (trimmed.startsWith("/")) return null;
  else inside = trimmed;
  const parts: string[] = [];
  for (const part of inside.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  if (parts.length === 0 || parts[0] === WORKSPACE) return null;
  return parts.join("/");
}

/** A use in a few words, as the user and the agent say it. */
export function describeUse(use: UseInput): string {
  switch (use.kind) {
    case "env":
      return `$${use.name}`;
    case "file":
      return use.env ? `file ${use.path} (with $${use.env} holding its path)` : `file ${use.path}`;
    case "server":
      return use.service === "model" ? `${use.target} models` : use.service === "voice" ? `${use.target} speech to text` : use.target;
  }
}

/** What an entry's field is called to the agent and in the masking: "Cloudflare token", or just the entry's name when it has one secret field. */
export const labelOf = (entry: Pick<SecretEntry, "name" | "secret">, field: string): string => (entry.secret.length === 1 ? entry.name : `${entry.name} ${field}`);

/** What a use takes for itself: its variable, its file, its variable for a file's path, its service. */
export function claimsOf(use: UseInput | Use): string[] {
  switch (use.kind) {
    case "env":
      return [`env ${use.name}`];
    case "file":
      return [`file ${use.path}`, ...(use.env ? [`env ${use.env}`] : [])];
    case "server":
      return [`server ${use.service} ${use.target}`];
  }
}

export type UseCheck = { ok: true; needsCard: boolean; use: UseInput } | { ok: false; reason: string };

/**
 * Whether `input` may be added to a field of `entry`, given every entry there is. A variable, a file or a service
 * belongs to one field: a taken one is refused, saying by whom. The card is for a secret field going into the sandbox
 * for the first time (its first use there); a second name for it, a plain field, and a service of the server's need none.
 */
export function checkUse(entries: readonly SecretEntry[], entryId: string, input: UseInput, home: string): UseCheck {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return { ok: false, reason: "That entry is not there any more." };
  const found = locate(entry, input.field);
  if (!found) return { ok: false, reason: `${entry.name} has no field called ${input.field}.` };
  const use: UseInput = input.kind === "file" ? { ...input, path: pathInHome(input.path, home) ?? input.path } : input;
  if (use.kind === "file" && pathInHome(use.path, home) === null) return { ok: false, reason: `${use.path} is not a file in the sandbox's home folder.` };
  if (use.kind === "server" && (found.side === "plain" || fieldKind(found) === "file")) return { ok: false, reason: "Only a line of secret text can be used by a service of Amuse's own." };
  if (use.kind === "env" && fieldKind(found) === "file") {
    const size = found.side === "plain" ? (found.field.value.kind === "file" ? fileSize(found.field.value.content) : 0) : found.field.size;
    if (size > MAX_ENV) return { ok: false, reason: `${found.field.name} is too big for a variable (${MAX_ENV / 1000} KB at most): use it as a file.` };
  }
  const wanted = claimsOf(use);
  for (const other of entries)
    for (const taken of other.uses) {
      if (!claimsOf(taken).some((c) => wanted.includes(c))) continue;
      const by = taken.field === input.field && other.id === entryId ? "this field" : `${other.name} ${taken.field}`;
      return { ok: false, reason: `${describeUse(taken)} is already used by ${by}.` };
    }
  const hasSandboxUse = entry.uses.some((u) => u.field === input.field && inSandbox(u));
  return { ok: true, needsCard: found.side === "secret" && inSandbox(use) && !hasSandboxUse, use };
}

/** The entry and secret field that serve `service` for `target` (OpenAI's models, the apps' Composio), if one does. */
export function serving(entries: readonly SecretEntry[], service: string, target: string): { entry: SecretEntry; use: Use } | undefined {
  for (const entry of entries) {
    const use = entry.uses.find((u) => u.kind === "server" && u.service === service && u.target === target);
    if (use) return { entry, use };
  }
  return undefined;
}

/** The longest a secret may be, to show four of its characters: of a shorter one that is too much of it. */
const HINT_FROM = 20;

/** The end of a line of text, for the user to tell keys apart: none for one too short to show a piece of safely. */
export const hintOf = (text: string): string | null => (text.length >= HINT_FROM ? `…${text.slice(-4)}` : null);

/** Every string in a JSON value, however deep. */
function strings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) strings(item, into);
}

/** The shortest line or string of a file's content that is masked on its own. */
const SHORTEST = 16;

/**
 * What to mask for a secret field's value: a line of text, as it is. A file's content as a whole, each of its lines
 * of 16 characters or more, and for JSON every string value of 16 or more (in its JSON form too, with the escapes a
 * private key has in the file, and by its own lines), so a `cat`, or a tool printing a part of the key, does not carry it to the agent.
 * What is not text is masked as base64 alone.
 */
export function maskings(name: string, content: Uint8Array | string): Masking[] {
  if (typeof content === "string") {
    if (content === "") return [];
    // a program that keeps it in JSON (the sandbox's own file of variables) shows it with its escapes
    const escaped = JSON.stringify(content).slice(1, -1);
    return [{ name, value: content }, ...(escaped === content ? [] : [{ name, value: escaped }])];
  }
  const values = new Set<string>();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return [{ name, value: btoa(String.fromCharCode(...content)) }];
  }
  values.add(text);
  for (const line of text.split(/\r?\n/)) if (line.trim().length >= SHORTEST) values.add(line.trim());
  try {
    const found: string[] = [];
    strings(JSON.parse(text), found);
    for (const s of found.filter((s) => s.length >= SHORTEST)) {
      values.add(s);
      values.add(JSON.stringify(s).slice(1, -1));
      // a key in a string has its lines (a program that decoded it may print one)
      for (const line of s.split(/\r?\n/)) if (line.trim().length >= SHORTEST) values.add(line.trim());
    }
  } catch {
    // not JSON: its lines are what there is
  }
  return [...values].filter((value) => value !== "").map((value) => ({ name, value }));
}

/** Why `answer` does not fit the card it answers, in words; null when it does. */
export function misfit(ask: SecretAsk, answer: SecretAnswer): string | null {
  if (ask.kind === "key") return "That card is answered by adding the key.";
  if (ask.kind === "temporary") return answer.kind === "temporary" ? null : "That card asks for a code.";
  if (answer.kind !== "stored") return "That card asks for the fields of a secret.";
  // the user types secrets only: the plain fields are Amuse's, and are on the card
  const need = ask.secret.map((f) => ({ ...f, given: answer.secret.find((g) => g.name === f.name) }));
  for (const field of need) {
    if (!field.given) return `${field.name} is missing.`;
    if (field.given.value.kind !== field.kind) return `${field.name} should be ${field.kind === "file" ? "a file" : "a line of text"}.`;
  }
  const extra = answer.secret.find((g) => !need.some((f) => f.name === g.name));
  return extra ? `${extra.name} was not asked for.` : null;
}

/** The ask in a few words, for the agent's context and its notes: what it is, and where it goes. */
export function askedFor(ask: SecretAsk): string {
  if (ask.kind === "temporary") return `a temporary code for terminal ${ask.pane}`;
  if (ask.kind === "key") return `the key of ${ask.provider}, for Amuse's own use`;
  const uses = ask.uses.map(describeUse).join(", ");
  return `a long-term secret for the Vault${uses ? `, to be set up as ${uses}` : ""}`;
}

/** What the agent is told when its card is answered (never a value). */
export function told(request: Pick<SecretRequest, "name" | "deliver">, provided: boolean): string {
  const { name, deliver } = request;
  // a key's card that is dismissed is dismissed: nothing to tell
  if (!provided && deliver.kind === "key") return "";
  if (deliver.kind === "key") return `[secret] The user added the key of ${name}, and it works for you now (you never see it). Carry on with what needed it.`;
  if (!provided) return `[secret] The user declined to give ${name}. Do not ask for it again unless they bring it up.`;
  if (deliver.kind === "temporary")
    return `[secret] The user typed ${name} into terminal ${deliver.pane}. Carry on with what waited for it (you never see it, and what the terminal shows of it is masked).`;
  const uses = deliver.uses.length > 0 ? `; it is set up as ${deliver.uses.map(describeUse).join(", ")}` : "; it has no use yet (use_secret adds one)";
  return `[secret] The user stored ${name} in the Vault${uses}. You never see its secret fields, and the sandbox's output shows them masked. Carry on with what needed it.`;
}

/** A service of the server's, with what it needs: the entry that serves it, and its fields as text. */
export interface ServiceKey {
  entry: SecretEntry;
  /** the field the use is for */
  field: string;
  /** every field of the entry that is a line of text, by name (the secret ones opened) */
  values: Record<string, string>;
}

/** What a service of the server's keeps: lines of text, plain or secret, and the services it serves. */
export interface ServiceWrite {
  /** the entry's name, when it is made */
  name: string;
  /** kept by the system (a sign-in): read-only in Settings */
  managed: boolean;
  targets: { service: ServerService; target: string }[];
  /** the secret field the targets' uses are for */
  bound: string;
  plain: { name: string; text: string }[];
  secret: { name: string; text: string }[];
}

/**
 * How the services of the server's (models, speech, apps) use the Vault: they look their key up by what they
 * serve, never by an entry. Pi's credentials go through this (pi/src/credentials.ts).
 */
export interface ServiceStore {
  /** What serves `service` for `target`, if anything does; records the use unless `record` is false (a refresh of a token is not a use). */
  serviceKey(service: string, target: string, record?: boolean): ServiceKey | undefined;
  /** Every service of the server's that has a key, as the service and target of its use. */
  serviceTargets(): { service: string; target: string }[];
  /** Keep what a service needs, as one entry that serves every one of `targets`: made, or changed in place. Atomic; no card, no record of use. */
  putService(write: ServiceWrite): Promise<void>;
  /** Forget a service's key: the entry that serves it goes, with its uses. */
  dropService(service: string, target: string): Promise<void>;
  /** Every value of a secret field of an entry a service uses (for error messages to leave out). */
  serviceSecrets(): string[];
}
