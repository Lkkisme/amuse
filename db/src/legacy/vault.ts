/**
 * The Vault's import, frozen as it was when written (migration 3): `keys.json` (the model, speech and Composio keys),
 * `models.json` (the model choice) and `sandbox-secrets.json` (what the user gave the sandbox) become rows, with every
 * secret sealed. It imports nothing from core, the protocol or the server: a later release may change how the Vault seals
 * or what an entry is without changing what this reads, and a test in api/ checks that what it seals opens in the Vault
 * of the day. In this order:
 *  1. every old file is read and checked (a file that cannot be read stops it, saying which, never what is in it);
 *  2. the Vault's key is read (or, when there is none and something is to be sealed, made) in the key folder;
 *  3. the rows are written in the migration's own transaction, and the two files that hold secrets are also kept as they
 *     were, but sealed, in imported_secret_files: no plaintext copy is left anywhere;
 *  4. the rows are read back, every secret is opened, and all of it is compared with what the files said;
 *  5. the transaction commits, and only then are the plaintext files taken away: keys.json and sandbox-secrets.json are
 *     deleted (the sealed copy is the way back), models.json is renamed to models.json.bak (it holds no secret).
 * A crash at any point leaves the old files alone (nothing committed: the import starts over) or the rows and the files
 * both (the last step is all that is left, and the next start refuses to go on until it is done).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Context, Finish } from "../migrations.ts";
import { type Db, query } from "../open.ts";
import { retired } from "./old-files.ts";

/** The files this takes in, by name in the data folder. */
export const VAULT_FILES = { keys: "keys.json", models: "models.json", sandbox: "sandbox-secrets.json" };
/** The two that hold secrets in the open: taken away after the import, never renamed to a plaintext backup. */
export const SECRET_FILES: readonly string[] = [VAULT_FILES.keys, VAULT_FILES.sandbox];
/** The Vault's key, in the key folder. */
export const KEY_NAME = "store.key";

/* ---------- sealing, as the Vault does it (api/src/seal.ts) ---------- */

const VERSION = 1;
const NONCE = 12;
const TAG = 16;
const KEY = 32;
const CHECK_VALUE = "amuse secret store";
const CHECK_ENTRY = "store";
const CHECK_FIELD = "check";

const bound = (entry: string, field: string) => Buffer.from(JSON.stringify([VERSION, entry, field]), "utf8");

/** `value`, sealed to `field` of `entry`: version byte, nonce, tag, ciphertext, in base64. */
export function seal(key: Buffer, value: Uint8Array, entry: string, field: string): string {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG });
  cipher.setAAD(bound(entry, field));
  const body = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), nonce, cipher.getAuthTag(), body]).toString("base64");
}

/** What `sealed` holds, or null when it does not open for this key, entry and field. */
export function open(key: Buffer, sealed: string, entry: string, field: string): Buffer | null {
  const bytes = Buffer.from(sealed, "base64");
  if (bytes[0] !== VERSION || bytes.length < 1 + NONCE + TAG) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + NONCE), { authTagLength: TAG });
    decipher.setAAD(bound(entry, field));
    decipher.setAuthTag(bytes.subarray(1 + NONCE, 1 + NONCE + TAG));
    return Buffer.concat([decipher.update(bytes.subarray(1 + NONCE + TAG)), decipher.final()]);
  } catch {
    return null;
  }
}

/** Flush a folder's entries (a new name in it), as far as the system lets. */
function flushed(folder: string): void {
  try {
    const fd = openSync(folder, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // some systems do not let a folder be flushed: the file itself was
  }
}

/** Write `data` to a new file `path` whole, flushed, owner-only, and never over another: false when there is one. */
function createOnce(path: string, data: Uint8Array): boolean {
  // a name of its own, made only if it is new: nothing left lying there is written into, or followed
  const temporary = `${path}.${randomBytes(6).toString("hex")}.new`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    for (let at = 0; at < data.length; ) at += writeSync(fd, data, at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
    // the new name is on the disk before anything that depended on the file being there (the plaintext files deleted) is done
    flushed(dirname(path));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(temporary);
  }
}

/** The Vault's key in `folder`: read, or made (when `make`). Null when there is none and none is to be made. */
function keyIn(folder: string, make: boolean): Buffer | null {
  const path = join(folder, KEY_NAME);
  const read = (): Buffer => {
    let key: Buffer;
    try {
      key = readFileSync(path);
    } catch {
      throw new Error("the Vault's key file could not be read (is it a folder, or is it not Amuse's to read?)");
    }
    if (key.length !== KEY) throw new Error(`the Vault's key file is not a key (it should be ${KEY} bytes): restore it from your backup`);
    return key;
  };
  if (existsSync(path)) return read();
  if (!make) return null;
  if (!existsSync(folder)) throw new Error("the folder for the Vault's key is not there");
  const key = randomBytes(KEY);
  return createOnce(path, key) ? key : read();
}

/* ---------- what the old files held ---------- */

const ApiKey = z.object({ type: z.literal("api_key"), key: z.string().optional(), env: z.record(z.string(), z.string()).optional() });
const OAuth = z.looseObject({ type: z.literal("oauth"), refresh: z.string(), access: z.string(), expires: z.number() });
const Keys = z.record(z.string(), z.discriminatedUnion("type", [ApiKey, OAuth]));
type Credential = z.infer<typeof ApiKey> | z.infer<typeof OAuth>;

const Sandbox = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    deliver: z.discriminatedUnion("kind", [z.object({ kind: z.literal("env"), name: z.string() }), z.object({ kind: z.literal("file"), path: z.string() }), z.looseObject({ kind: z.literal("stdin") })]),
    value: z.string(),
  }),
);

const Choice = z.object({
  chat: z.string().nullable(),
  browser: z.string().nullable(),
  background: z.string().nullable().default(null),
  voice: z.string().nullable().default(null),
  localVoice: z.object({ url: z.string(), model: z.string() }).nullable().default(null),
  thinking: z
    .object({
      chat: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
      browser: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
      background: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).default("off"),
    })
    .default({ chat: "off", browser: "off", background: "off" }),
});

/* ---------- what an entry is, as these files make one ---------- */

interface Field {
  name: string;
  role: "password" | null;
  kind: "text" | "file";
  filename: string | null;
  bytes: Uint8Array;
}
interface Use {
  id: string;
  field: string;
  kind: "env" | "file" | "server";
  name: string | null;
  path: string | null;
  env: string | null;
  service: string | null;
  target: string | null;
}
interface Fresh {
  id: string;
  name: string;
  managed: boolean;
  plain: { name: string; value: string }[];
  secret: Field[];
  uses: Use[];
}

const SPEECH = ["openai", "groq", "fireworks"];
const LOCAL_VOICE = "local-voice";
const APPS = ["composio"];
const HOME = "/home/amuse";

/** What a provider's credential id serves. */
function serves(id: string): { service: string; target: string }[] {
  if (APPS.includes(id)) return [{ service: "apps", target: id }];
  if (id === LOCAL_VOICE) return [{ service: "voice", target: "local" }];
  return [{ service: "model", target: id }, ...(SPEECH.includes(id) ? [{ service: "voice", target: id }] : [])];
}

/** An entry's name for a credential: the provider's id as it is (the server gives it its proper name when it starts). */
const nameOf = (id: string) => (id === "composio" ? "Composio" : id === LOCAL_VOICE ? "Your speech server" : id);

const PLAIN_SETTING = /(ACCOUNT_ID|PROJECT|REGION|LOCATION|ENDPOINT|URL|HOST|RESOURCE_NAME)/;
const SECRET_LOOKING = /(KEY|SECRET|TOKEN|PASSWORD)/;
const isPlainSetting = (name: string) => PLAIN_SETTING.test(name) && !SECRET_LOOKING.test(name);
const MAX_LINE = 20_000;
const MAX_FILE = 64 * 1024;
const AS_JSON = ":json";
const text = (value: string): Field["bytes"] => new TextEncoder().encode(value);

const secretField = (name: string, value: string): Field => ({ name, role: null, kind: "text", filename: null, bytes: text(value) });

/** A credential of the keys file as an entry. */
function entryOfKey(id: string, given: Credential): Fresh | null {
  // an empty value is no value: a key or setting left blank is not kept (and a credential of nothing else is not an entry)
  const credential: Credential =
    given.type === "oauth"
      ? given
      : { type: "api_key", ...(given.key ? { key: given.key } : {}), env: Object.fromEntries(Object.entries(given.env ?? {}).filter(([, value]) => value !== "")) };
  const entry: Fresh = { id: `e-${randomUUID()}`, name: nameOf(id), managed: false, plain: [], secret: [], uses: [] };
  let bound: string;
  if (credential.type === "oauth") {
    const { type: _, refresh, access, expires, ...rest } = credential;
    entry.managed = true;
    entry.secret.push(secretField("access", access), secretField("refresh", refresh));
    entry.plain.push({ name: "expires", value: String(expires) });
    for (const [name, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      entry.plain.push(typeof value === "string" ? { name, value } : { name: `${name}${AS_JSON}`, value: JSON.stringify(value) });
    }
    bound = "access";
  } else {
    const env = Object.entries(credential.env ?? {});
    const secret = [...(credential.key === undefined ? [] : [{ name: "key", value: credential.key }]), ...env.filter(([name]) => !isPlainSetting(name)).map(([name, value]) => ({ name, value }))];
    // settings alone have a secret to keep too: they are all kept as secrets then
    const alone = secret.length === 0;
    const kept = alone ? env.map(([name, value]) => ({ name, value })) : secret;
    const first = kept[0];
    if (!first) return null;
    for (const { name, value } of kept) entry.secret.push(secretField(name, value));
    if (!alone) for (const [name, value] of env.filter(([n]) => isPlainSetting(n))) entry.plain.push({ name, value });
    bound = credential.key === undefined ? first.name : "key";
  }
  for (const { name, value } of [...entry.plain, ...entry.secret.map((f) => ({ name: f.name, value: new TextDecoder().decode(f.bytes) }))])
    if (/[\r\n]/.test(value) || value.length > MAX_LINE) throw new Error(`a setting of the key for ${id} (${name}) is not a line of text`);
  for (const t of serves(id)) entry.uses.push({ id: `u-${randomUUID()}`, field: bound, kind: "server", name: null, path: null, env: null, service: t.service, target: t.target });
  return entry;
}

/** A path as the sandbox keeps a credential file: in its home, never the workspace; null for what the daemon refuses. */
function pathInHome(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.includes("\0") || trimmed === "~" || trimmed === HOME) return null;
  let inside: string;
  if (trimmed.startsWith("~/")) inside = trimmed.slice(2);
  else if (trimmed.startsWith(`${HOME}/`)) inside = trimmed.slice(HOME.length + 1);
  else if (trimmed.startsWith("/")) return null;
  else inside = trimmed;
  const parts: string[] = [];
  for (const part of inside.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.length === 0 || parts[0] === "workspace" ? null : parts.join("/");
}

/** The sandbox's credentials as entries: a variable or a file each; a terminal's code is dropped. */
function entriesOfSandbox(old: z.infer<typeof Sandbox>, taken: Set<string>): { entries: Fresh[]; dropped: number; left: string[]; empty: string[] } {
  const entries: Fresh[] = [];
  const left: string[] = [];
  const empty: string[] = [];
  let dropped = 0;
  for (const credential of old) {
    const { deliver } = credential;
    if (deliver.kind !== "stdin" && credential.value === "") {
      empty.push(credential.name);
      continue;
    }
    if (deliver.kind === "stdin") {
      dropped += 1;
      continue;
    }
    const file = deliver.kind === "file" ? pathInHome(deliver.path) : null;
    const claim = deliver.kind === "env" ? `env ${deliver.name}` : `file ${file ?? ""}`;
    if ((deliver.kind === "file" && file === null) || taken.has(claim)) {
      left.push(credential.name);
      continue;
    }
    const multiline = /[\r\n]/.test(credential.value) || credential.value.length > MAX_LINE;
    const bytes = text(credential.value);
    if (multiline && bytes.length > MAX_FILE) {
      left.push(credential.name);
      continue;
    }
    taken.add(claim);
    const field: Field = multiline
      ? { name: "key", role: null, kind: "file", filename: deliver.kind === "file" ? (deliver.path.split("/").pop() ?? "key") || "key" : "key", bytes }
      : { name: "key", role: null, kind: "text", filename: null, bytes };
    entries.push({
      id: `e-${randomUUID()}`,
      name: credential.name.trim() || "Credential",
      managed: false,
      plain: [],
      secret: [field],
      uses: [
        deliver.kind === "env"
          ? { id: `u-${randomUUID()}`, field: "key", kind: "env", name: deliver.name, path: null, env: null, service: null, target: null }
          : { id: `u-${randomUUID()}`, field: "key", kind: "file", name: null, path: file, env: null, service: null, target: null },
      ],
    });
  }
  return { entries, dropped, left, empty };
}

/** The end of a line of text for the user to tell keys apart; none for one that is short. */
const hintOf = (value: string): string | null => (value.length >= 20 ? `…${value.slice(-4)}` : null);

const claimsOf = (use: Use): string[] =>
  use.kind === "env" ? [`env ${use.name}`] : use.kind === "file" ? [`file ${use.path}`, ...(use.env ? [`env ${use.env}`] : [])] : [`server ${use.service} ${use.target}`];

/* ---------- reading, writing, checking ---------- */

interface Read {
  name: string;
  path: string;
  buffer: Buffer;
}

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** The old file `name` in the data folder, if it is there. */
function read(context: Omit<Context, "db">, name: string): Read | null {
  const path = join(context.dataDir, name);
  return existsSync(path) ? { name, path, buffer: readFileSync(path) } : null;
}

/** A file's JSON, read by `schema`; the error names the file and never says what is in it. */
function parsed<S extends z.ZodType>(file: Read, schema: S): z.output<S> {
  let json: unknown;
  try {
    json = JSON.parse(file.buffer.toString("utf8"));
  } catch {
    throw new Error(`${file.name}: not valid JSON; move the file aside to start over`);
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new Error(`${file.name}: it does not hold what Amuse kept there (${result.error.issues[0]?.path.join(".") || "the file"}); move it aside to start over`);
  return result.data;
}

/** What the old files hold, read and turned into entries: no key is touched and nothing is written, so the dry run can do it as well. */
interface Plan {
  files: Read[];
  choice: z.infer<typeof Choice> | null;
  entries: Fresh[];
  fromKeys: number;
  sandbox: { count: number; dropped: number; left: string[]; empty: string[] };
  /** keys with no key and no settings (left blank), by id */
  blank: string[];
  /** plaintext copies of the two files that an older Amuse left beside them: .tmp of a write cut short, and .bak of an import */
  strays: string[];
}

function build(context: Omit<Context, "db">): Plan | null {
  const keysFile = read(context, VAULT_FILES.keys);
  const modelsFile = read(context, VAULT_FILES.models);
  const sandboxFile = read(context, VAULT_FILES.sandbox);
  const files = [keysFile, modelsFile, sandboxFile].filter((f): f is Read => f !== null);
  const strays = (existsSync(context.dataDir) ? readdirSync(context.dataDir) : []).filter((name) => SECRET_FILES.some((own) => name.startsWith(`${own}.bak`) || name === `${own}.tmp`));
  if (files.length === 0 && strays.length === 0) return null;

  // read and check
  const keys = keysFile ? parsed(keysFile, Keys) : {};
  const choice = modelsFile ? parsed(modelsFile, Choice) : null;
  const old = sandboxFile ? parsed(sandboxFile, Sandbox) : [];
  const blank: string[] = [];
  const fromKeys: Fresh[] = [];
  for (const [id, credential] of Object.entries(keys)) {
    const entry = entryOfKey(id, credential);
    if (entry) fromKeys.push(entry);
    else blank.push(id);
  }
  const claimed = new Set(fromKeys.flatMap((e) => e.uses.flatMap(claimsOf)));
  const sandbox = entriesOfSandbox(old, claimed);
  const entries = [...fromKeys, ...sandbox.entries];
  // names are one each, however cased
  const names = new Set<string>();
  for (const entry of entries) {
    let name = entry.name;
    for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${entry.name} (${n})`;
    names.add(name.toLowerCase());
    entry.name = name;
  }
  return { files, choice, entries, fromKeys: fromKeys.length, sandbox: { count: sandbox.entries.length, dropped: sandbox.dropped, left: sandbox.left, empty: sandbox.empty }, blank, strays };
}

/** What would be imported, in words, without touching anything: the same reading as the import, so what would stop it, what it would leave out and drop is said now. */
export function describeVault(context: Omit<Context, "db">): string[] {
  let plan: Plan | null;
  try {
    plan = build(context);
  } catch (error) {
    return [`the import would stop, and nothing would be changed: ${error instanceof Error ? error.message : "it cannot be read"}`];
  }
  if (!plan) return ["no old keys, model choice or sandbox credentials to import"];
  const say: string[] = [];
  for (const file of plan.files) say.push(`import ${file.name} (${file.buffer.length} bytes)${SECRET_FILES.includes(file.name) ? ", sealed, and delete the file" : ""}`);
  say.push(`make ${plan.entries.length} entr${plan.entries.length === 1 ? "y" : "ies"} (${plan.fromKeys} from keys, ${plan.sandbox.count} from sandbox credentials)`);
  if (plan.sandbox.dropped > 0) say.push(`drop ${plan.sandbox.dropped} code${plan.sandbox.dropped === 1 ? "" : "s"} typed into terminals (kept nowhere)`);
  for (const name of plan.sandbox.left) say.push(`leave out the sandbox credential "${name}" (its variable or file is taken, it is not in the sandbox's home, or it is too big)`);
  for (const name of plan.sandbox.empty) say.push(`leave out the sandbox credential "${name}": its value is empty`);
  for (const id of plan.blank) say.push(`leave out the key for ${id}: it has no key and no settings`);
  for (const name of plan.strays) say.push(`${name} is a plaintext copy beside them: it is ${name.endsWith(".tmp") ? "deleted" : "not touched, and said in the log; delete it once the Vault has everything"}`);
  if (plan.files.some((f) => SECRET_FILES.includes(f.name))) say.push("keep keys.json and sandbox-secrets.json only as sealed copies in the database (imported_secret_files)");
  if (plan.files.some((f) => f.name === VAULT_FILES.models)) say.push("rename models.json to models.json.bak");
  return say;
}

const Count = z.object({ n: z.number() });

export function importVault(context: Context): Finish {
  const { db, log } = context;
  const plan = build(context);
  if (!plan) return () => {};
  const { files, choice, entries, fromKeys, sandbox } = plan;
  const strays = plan.strays;

  // 2. the key
  const sealing = entries.length > 0 || SECRET_FILES.some((name) => files.some((f) => f.name === name));
  const key = keyIn(context.secretsDir, sealing);
  if (sealing && !key) throw new Error("the Vault's key could not be made");

  // 3. write
  const now = new Date().toISOString();
  if (key) {
    const present = query(db, Count, "select count(*) as n from vault_check")[0]?.n ?? 0;
    if (present === 0) db.prepare("insert into vault_check (id, sealed) values (1, ?)").run(seal(key, text(CHECK_VALUE), CHECK_ENTRY, CHECK_FIELD));
  }
  const insertEntry = db.prepare("insert into secrets (id, name, managed, note, created) values (?, ?, ?, '', ?)");
  const insertPlain = db.prepare("insert into secret_plain (entry, position, name, role, kind, value, filename) values (?, ?, ?, null, 'text', ?, null)");
  const insertField = db.prepare(
    "insert into secret_fields (entry, position, name, role, kind, filename, size, hint, sealed, last_at, last_how, last_what) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, null)",
  );
  const insertUse = db.prepare("insert into secret_uses (id, entry, position, field, kind, name, path, env, service, target) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertClaim = db.prepare("insert into secret_claims (claim, use) values (?, ?)");
  for (const entry of entries) {
    if (!key) break;
    insertEntry.run(entry.id, entry.name, entry.managed ? 1 : 0, now);
    entry.plain.forEach((f, position) => insertPlain.run(entry.id, position, f.name, f.value));
    entry.secret.forEach((f, position) => {
      const value = new TextDecoder().decode(f.bytes);
      insertField.run(entry.id, position, f.name, f.role, f.kind, f.filename, f.bytes.length, f.kind === "text" ? hintOf(value) : null, seal(key, f.bytes, entry.id, f.name));
    });
    entry.uses.forEach((u, position) => {
      insertUse.run(u.id, entry.id, position, u.field, u.kind, u.name, u.path, u.env, u.service, u.target);
      for (const claim of claimsOf(u)) insertClaim.run(claim, u.id);
    });
  }
  if (choice) db.prepare("insert into model_choice (id, choice) values (1, ?)").run(JSON.stringify(choice));
  for (const file of files) {
    if (key && SECRET_FILES.includes(file.name)) db.prepare("insert into imported_secret_files (name, sealed) values (?, ?)").run(file.name, seal(key, file.buffer, "imported-file", file.name));
    db.prepare("insert into imported_files (name, bytes, sha256, imported_at) values (?, ?, ?, ?)").run(file.name, file.buffer.length, sha(file.buffer), now);
  }

  // 4. read it back, and open every secret
  const verify = (what: string, ok: boolean) => {
    if (!ok) throw new Error(`the import was checked against the old files and ${what} did not match; nothing was changed`);
  };
  if (key) {
    const check = query(db, z.object({ sealed: z.string() }), "select sealed from vault_check")[0];
    verify("the Vault's check value", check !== undefined && open(key, check.sealed, CHECK_ENTRY, CHECK_FIELD)?.toString("utf8") === CHECK_VALUE);
    for (const entry of entries) {
      const row = query(db, z.object({ name: z.string(), managed: z.number() }), "select name, managed from secrets where id = ?", entry.id)[0];
      verify(`the entry ${entry.name}`, row?.name === entry.name && row.managed === (entry.managed ? 1 : 0));
      const fields = query(db, z.object({ name: z.string(), sealed: z.string() }), "select name, sealed from secret_fields where entry = ? order by position", entry.id);
      verify(`the secrets of ${entry.name}`, fields.length === entry.secret.length && fields.every((f, i) => {
        const wanted = entry.secret[i];
        return wanted !== undefined && f.name === wanted.name && Buffer.compare(open(key, f.sealed, entry.id, f.name) ?? Buffer.alloc(0), wanted.bytes) === 0 && wanted.bytes.length > 0;
      }));
      const plain = query(db, z.object({ name: z.string(), value: z.string() }), "select name, value from secret_plain where entry = ? order by position", entry.id);
      verify(`the plain fields of ${entry.name}`, plain.length === entry.plain.length && plain.every((f, i) => f.name === entry.plain[i]?.name && f.value === entry.plain[i]?.value));
      const uses = query(db, Count, "select count(*) as n from secret_uses where entry = ?", entry.id)[0]?.n;
      verify(`the uses of ${entry.name}`, uses === entry.uses.length);
    }
    for (const file of files.filter((f) => SECRET_FILES.includes(f.name))) {
      const kept = query(db, z.object({ sealed: z.string() }), "select sealed from imported_secret_files where name = ?", file.name)[0];
      verify(`the sealed copy of ${file.name}`, kept !== undefined && open(key, kept.sealed, "imported-file", file.name)?.equals(file.buffer) === true);
    }
  }
  if (choice) {
    const stored = query(db, z.object({ choice: z.string() }), "select choice from model_choice")[0];
    verify("the model choice", stored !== undefined && isDeepStrictEqual(Choice.parse(JSON.parse(stored.choice)), choice));
  }

  const said = [
    `${fromKeys} key${fromKeys === 1 ? "" : "s"}`,
    `${sandbox.count} sandbox credential${sandbox.count === 1 ? "" : "s"}`,
    ...(sandbox.dropped > 0 ? [`${sandbox.dropped} typed code${sandbox.dropped === 1 ? "" : "s"} dropped`] : []),
    ...(choice ? ["the model choice"] : []),
  ].join(", ");
  log(`Imported into the Vault: ${said}. keys.json and sandbox-secrets.json are deleted (they held secrets in the open); a sealed copy of each is kept in the database.`);
  for (const name of sandbox.left) log(`The sandbox credential "${name}" was left out of the Vault: its variable or file is already used, or it is not somewhere the sandbox accepts, or it is too big. It is only in the sealed copy of sandbox-secrets.json.`);
  for (const name of sandbox.empty) log(`The sandbox credential "${name}" has an empty value, so it was not kept.`);
  for (const id of plan.blank) log(`The key for ${id} has no key and no settings (it was left blank), so it was not kept.`);
  const copies = strays.filter((name) => !name.endsWith(".tmp"));
  if (copies.length > 0) log(`${copies.join(", ")} ${copies.length === 1 ? "is a plaintext copy" : "are plaintext copies"} of what the Vault now holds, left beside the data by an older Amuse: delete ${copies.length === 1 ? "it" : "them"} once you have checked that all is well.`);

  // 5. after the commit
  return () => {
    for (const file of files) {
      if (SECRET_FILES.includes(file.name)) rmSync(file.path, { force: true });
      else renameSync(file.path, retired(file.path));
    }
    // a write cut short of an older Amuse left a plaintext half beside each of them
    for (const name of strays.filter((n) => n.endsWith(".tmp"))) rmSync(join(context.dataDir, name), { force: true });
  };
}

/**
 * The two files that hold secrets, written back as they were from their sealed copies (for going back to an older Amuse,
 * or to read them): the Vault's key must be there to open them. A file that is already there is not written over.
 * Returns the names written.
 */
export function restoreSecretFiles(db: Db, context: Pick<Context, "dataDir" | "secretsDir">): { written: string[]; there: string[] } {
  const key = keyIn(context.secretsDir, false);
  const rows = query(db, z.object({ name: z.string(), sealed: z.string() }), "select name, sealed from imported_secret_files order by name");
  if (rows.length > 0 && !key) throw new Error("the Vault's key is not there, so the sealed copies cannot be opened");
  const written: string[] = [];
  const there: string[] = [];
  for (const { name, sealed } of rows) {
    if (!key) break;
    const path = join(context.dataDir, name);
    if (existsSync(path)) {
      there.push(name);
      continue;
    }
    const content = open(key, sealed, "imported-file", name);
    if (!content) throw new Error(`${name}: its sealed copy does not open with this key`);
    if (!createOnce(path, content)) there.push(name);
    else written.push(name);
  }
  return { written, there };
}

/** The sealed copies deleted, once the user is satisfied the Vault has everything: how many there were. */
export function forgetSecretFiles(db: Db): number {
  const n = query(db, Count, "select count(*) as n from imported_secret_files")[0]?.n ?? 0;
  db.exec("delete from imported_secret_files");
  return n;
}
