/**
 * Migration 1's work: the files the server used to keep beside its journal become rows. In this order:
 *  1. every old file is read and checked (nothing is changed yet; a file that cannot be read stops it, with its name);
 *  2. the rows are written in the migration's own transaction;
 *  3. the rows are read back and compared with what the files said (events by count and a hash of each chat's log);
 *  4. the transaction commits, and only then is each old file renamed to <name>.bak.
 * The old files are never edited or deleted, so a crash at any point leaves either the old files alone (the transaction
 * did not commit: the import starts over) or the rows and the files both (the rename is the only step left).
 *
 * Left out on purpose: keys.json, models.json and sandbox-secrets.json (the Secret store moves them in its own migration).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type AllRules, noRules } from "@amuse/core";
import { Attachment, BrowserAction, Chat, MAIN, Permission, type SiteActions, type SiteEntry, ToolKind } from "@amuse/protocol";
import { z } from "zod";
import type { Context, Finish } from "../migrations.ts";
import { type Db, query } from "../open.ts";
import { readJournalFile } from "./journal.ts";
import { readRules } from "./rules.ts";

/** A side chat's id as a file name: only ids the host makes (letters, digits, dashes) ever reached the disk. */
const safeId = /^[A-Za-z0-9-]{1,80}$/;

const Access = z.object({
  password: z.object({ salt: z.string(), hash: z.string() }),
  sessions: z.array(z.string()),
});
const Marker = z.object({ done: z.boolean().optional(), set: z.array(z.string()).optional() });
const Sent = z.record(z.string(), z.object({ attachment: Attachment, by: z.enum(["user", "muse"]) }));
/** What defaults.json meant before defaults were kept one by one: the first four. */
const firstDefaults = ["memory", "people", "reflection", "wrap-up"];

/** An old file that was read: where, and what it was (for imported_files, and the rename). */
interface Read {
  path: string;
  bytes: number;
  sha256: string;
}

const files = (context: Omit<Context, "db">) => ({
  chats: join(context.dataDir, "chats.json"),
  rules: join(context.dataDir, "rules.json"),
  access: join(context.dataDir, "access.json"),
  defaults: join(context.dataDir, "defaults.json"),
  sent: join(context.dataDir, "sent.json"),
  side: join(context.dataDir, "chats"),
});

/** What would be imported, in words, without touching anything. */
export function describeLegacy(context: Omit<Context, "db">): string[] {
  const where = files(context);
  const side = existsSync(where.side) ? readdirSync(where.side).filter((name) => name.endsWith(".jsonl")).map((name) => join(where.side, name)) : [];
  const found = [context.journal, where.chats, ...side, where.rules, where.access, where.defaults, where.sent].filter((path) => existsSync(path));
  if (found.length === 0) return ["no old files to import: a new instance"];
  return [...found.map((path) => `import ${relative(context.dataDir, path)} (${statSync(path).size} bytes)`), "then rename each of them to <name>.bak (never deleted)"];
}

/** A file's text and what it was, read once. */
function readJson(path: string): { json: unknown; file: Read } {
  const buffer = readFileSync(path);
  try {
    return { json: JSON.parse(buffer.toString("utf8")), file: { path, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") } };
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error instanceof Error ? error.message : String(error)}); move the file aside to start over`);
  }
}

const eventsLine = (seq: number, event: string) => `${seq}:${event}\n`;

/** Rows of a chat's log, read back as a count and a hash. */
function logOf(db: Db, chat: string): { events: number; sha256: string } {
  const hash = createHash("sha256");
  let events = 0;
  for (const row of db.prepare("select seq, event from events where chat = ? order by seq").iterate(chat)) {
    const { seq, event } = z.object({ seq: z.number(), event: z.string() }).parse(row);
    hash.update(eventsLine(seq, event));
    events += 1;
  }
  return { events, sha256: hash.digest("hex") };
}

const sameOrThrow = (what: string, wanted: unknown, got: unknown) => {
  if (!isDeepStrictEqual(wanted, got)) throw new Error(`the import was checked against the old files and ${what} did not match; nothing was changed`);
};

const Row = {
  chat: z.object({ id: z.string(), title: z.string(), at: z.string(), updated: z.string() }),
  app: z.object({ app: z.string(), kind: ToolKind, permission: Permission }),
  browser: z.object({ action: BrowserAction, permission: Permission }),
  site: z.object({ site: z.string(), never: z.number(), visit: Permission.nullable(), submit: Permission.nullable(), download: Permission.nullable(), upload: Permission.nullable() }),
};

function rulesIn(db: Db): AllRules {
  const apps: AllRules["apps"] = {};
  for (const { app, kind, permission } of query(db, Row.app, "select app, kind, permission from app_rules")) apps[app] = { ...apps[app], [kind]: permission };
  const browser: SiteActions = {};
  for (const { action, permission } of query(db, Row.browser, "select action, permission from browser_rules")) browser[action] = permission;
  const sites: Record<string, SiteEntry> = {};
  for (const { site, never, ...stored } of query(db, Row.site, "select site, never, visit, submit, download, upload from site_rules")) {
    const actions: SiteActions = {};
    for (const [action, permission] of Object.entries(stored)) {
      const known = BrowserAction.safeParse(action);
      if (known.success && permission !== null) actions[known.data] = permission;
    }
    sites[site] = { never: never === 1, actions };
  }
  return { apps, browser, sites };
}

/** `path`.bak, or the first of .bak.2, .bak.3 … that is free: an earlier import's file is never written over. */
function retired(path: string): string {
  for (let n = 1; ; n++) {
    const target = n === 1 ? `${path}.bak` : `${path}.bak.${n}`;
    if (!existsSync(target)) return target;
  }
}

export function importLegacy(context: Context): Finish {
  const { db, log } = context;
  const where = files(context);
  const read: Read[] = [];
  const seen = (file: Read) => void read.push(file);

  // 1. read and check every file
  let chats: Chat[] = [];
  if (existsSync(where.chats)) {
    const { json, file } = readJson(where.chats);
    chats = z.array(Chat).parse(json);
    seen(file);
  }
  const side = chats.filter((chat) => chat.id !== MAIN);
  for (const { id } of side) if (!safeId.test(id)) throw new Error(`${where.chats}: "${id}" is not a chat id this version can keep`);
  const rules = (() => {
    if (!existsSync(where.rules)) return noRules;
    const { json, file } = readJson(where.rules);
    seen(file);
    return readRules(json, (message) => log(message)).rules;
  })();
  const access = (() => {
    if (!existsSync(where.access)) return null;
    const { json, file } = readJson(where.access);
    seen(file);
    return Access.parse(json);
  })();
  const defaults = (() => {
    if (!existsSync(where.defaults)) return [];
    const { json, file } = readJson(where.defaults);
    seen(file);
    const marker = Marker.safeParse(json);
    return marker.success ? (marker.data.set ?? (marker.data.done ? firstDefaults : [])) : [];
  })();
  const sent = (() => {
    if (!existsSync(where.sent)) return {};
    const { json, file } = readJson(where.sent);
    seen(file);
    return Sent.parse(json);
  })();

  // 2. write the rows, the journals as they are read (a log is not held whole)
  const insertChat = db.prepare("insert into chats (id, title, at, updated) values (?, ?, ?, ?) on conflict (id) do update set title = excluded.title, at = excluded.at, updated = excluded.updated");
  for (const chat of chats) insertChat.run(chat.id, chat.title, chat.at, chat.updated);
  const insertEvent = db.prepare("insert into events (chat, seq, event) values (?, ?, ?)");
  const logs = new Map<string, { events: number; sha256: string }>();
  const journals: { chat: string; path: string }[] = [
    { chat: MAIN, path: context.journal },
    ...side.map(({ id }) => ({ chat: id, path: join(where.side, `${id}.jsonl`) })),
  ];
  for (const { chat, path } of journals) {
    if (!existsSync(path)) continue;
    const hash = createHash("sha256");
    const result = readJournalFile(path, ({ seq, event }) => {
      const stored = JSON.stringify(event);
      insertEvent.run(chat, seq, stored);
      hash.update(eventsLine(seq, stored));
    });
    seen({ path, bytes: result.bytes, sha256: result.sha256 });
    logs.set(chat, { events: result.events, sha256: hash.digest("hex") });
    if (result.torn > 0) log(`${basename(path)}: the last ${result.torn} bytes were a write cut short, and were left out.`);
  }
  for (const [app, kinds] of Object.entries(rules.apps))
    for (const [kind, permission] of Object.entries(kinds)) if (permission !== undefined) db.prepare("insert into app_rules (app, kind, permission) values (?, ?, ?)").run(app, kind, permission);
  for (const [action, permission] of Object.entries(rules.browser))
    if (permission !== undefined) db.prepare("insert into browser_rules (action, permission) values (?, ?)").run(action, permission);
  for (const [site, { never, actions }] of Object.entries(rules.sites))
    db.prepare("insert into site_rules (site, never, visit, submit, download, upload) values (?, ?, ?, ?, ?, ?)").run(site, never ? 1 : 0, actions.visit ?? null, actions.submit ?? null, actions.download ?? null, actions.upload ?? null);
  const sessions = access ? [...new Set(access.sessions)] : [];
  if (access) db.prepare("insert into access (id, salt, hash) values (1, ?, ?)").run(access.password.salt, access.password.hash);
  for (const digest of sessions) db.prepare("insert into sessions (digest) values (?)").run(digest);
  for (const key of new Set(defaults)) db.prepare("insert into defaults_set (key) values (?)").run(key);
  for (const [id, { attachment, by }] of Object.entries(sent)) db.prepare("insert into sent (id, by, attachment) values (?, ?, ?)").run(id, by, JSON.stringify(attachment));
  for (const file of read)
    db.prepare("insert into imported_files (name, bytes, sha256, imported_at) values (?, ?, ?, ?)").run(relative(context.dataDir, file.path), file.bytes, file.sha256, new Date().toISOString());

  // 3. read it all back
  for (const chat of chats) sameOrThrow(`the chat ${chat.id}`, chat, query(db, Row.chat, "select id, title, at, updated from chats where id = ?", chat.id)[0]);
  for (const { chat } of journals) sameOrThrow(`the log of the chat ${chat}`, logs.get(chat) ?? { events: 0, sha256: createHash("sha256").digest("hex") }, logOf(db, chat));
  const wanted: AllRules = { ...rules, apps: Object.fromEntries(Object.entries(rules.apps).filter(([, kinds]) => Object.keys(kinds).length > 0)) };
  sameOrThrow("the rules", wanted, rulesIn(db));
  sameOrThrow(
    "the password and sessions",
    access ? { salt: access.password.salt, hash: access.password.hash, sessions } : null,
    (() => {
      const row = query(db, z.object({ salt: z.string(), hash: z.string() }), "select salt, hash from access")[0];
      return row ? { ...row, sessions: query(db, z.object({ digest: z.string() }), "select digest from sessions order by position").map((s) => s.digest) } : null;
    })(),
  );
  sameOrThrow("the defaults set up", [...new Set(defaults)].sort(), query(db, z.object({ key: z.string() }), "select key from defaults_set order by key").map((row) => row.key));
  sameOrThrow(
    "the index of sent files",
    sent,
    Object.fromEntries(query(db, z.object({ id: z.string(), by: z.enum(["user", "muse"]), attachment: z.string() }), "select id, by, attachment from sent").map((row) => [row.id, { by: row.by, attachment: Attachment.parse(JSON.parse(row.attachment)) }])),
  );

  if (read.length === 0) return () => {};
  const events = [...logs.values()].reduce((sum, { events: n }) => sum + n, 0);
  log(`Imported the old files: ${events} events in ${logs.size} chat${logs.size === 1 ? "" : "s"}, ${chats.length} chats, ${read.length} files in all. They are renamed to <name>.bak, and kept.`);

  // 4. after the commit
  return () => {
    for (const { path } of read) renameSync(path, retired(path));
  };
}
