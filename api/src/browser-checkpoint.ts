/** Owner-only stop/start checkpoint. Never registered as an RPC or agent tool. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { apply, Browser, Chat, empty, Envelope, MAIN, type State } from "@amuse/protocol";
import { z } from "zod";
import { openReadOnly } from "@amuse/db";
import { eventsOf } from "./journal.ts";

const safeId = /^[A-Za-z0-9-]{1,80}$/;
export const BrowserCheckpoint = z.object({
  version: z.literal(1), source: z.literal("owner-stop"), id: z.uuid(), createdAt: z.iso.datetime(),
  journalPath: z.string().min(1), ownerPid: z.number().int().positive().nullable(),
  browsers: z.array(z.object({ chat: z.string().regex(safeId), seq: z.number().int().nonnegative(), browser: Browser.refine((browser) => browser.live && ["paused", "idle"].includes(browser.status), "Only a live paused or idle page may be checkpointed.") })),
});
export type BrowserCheckpoint = z.infer<typeof BrowserCheckpoint>;

/** Like fileJournal.load, but a torn final line is ignored without changing one byte. */
export function readBrowserJournal(path: string): State {
  if (!existsSync(path)) return structuredClone(empty);
  const text = readFileSync(path, "utf8");
  const lines = text.slice(0, text.lastIndexOf("\n") + 1).split("\n");
  let state: State = structuredClone(empty);
  for (const line of lines) {
    if (!line) continue;
    const event = Envelope.parse(JSON.parse(line));
    if (event.seq !== state.seq + 1) throw new Error(`${path}: line ${state.seq + 1} is not the next journal event.`);
    state = apply(state, event);
  }
  return state;
}

export function snapshotBrowsers(options: { journalPath: string; directory: string; ownerPid?: number; now?: Date }): BrowserCheckpoint {
  const journalPath = resolve(options.journalPath);
  const data = dirname(journalPath);
  const browsers: BrowserCheckpoint["browsers"] = [];
  const keep = (chat: string, state: State) => {
    if (!safeId.test(chat)) throw new Error(`Invalid checkpoint chat id: ${chat}`);
    for (const browser of state.entities) if (browser.kind === "browser" && browser.live && ["paused", "idle"].includes(browser.status)) browsers.push({ chat, seq: state.seq, browser });
  };
  const database = join(data, "amuse.db");
  if (existsSync(database)) {
    // Never open a candidate checkout or run migration here. The database beside
    // this exact journal is authoritative; a damaged DB must not revive stale JSONL.
    // openReadOnly sees a running server's committed WAL and leaves an idle DB immutable.
    const db = openReadOnly(database);
    try {
      db.exec("begin");
      const chats = z.array(Chat).parse(db.prepare("select id, title, at, updated from chats order by at, id").all());
      for (const chat of new Set([MAIN, ...chats.map((chat) => chat.id)])) {
        let state: State = structuredClone(empty);
        for (const envelope of eventsOf(db, chat)) state = apply(state, envelope);
        keep(chat, state);
      }
      db.exec("commit");
    } finally { db.close(); }
  } else {
    const list = join(data, "chats.json");
    const chats = existsSync(list) ? z.array(Chat).parse(JSON.parse(readFileSync(list, "utf8"))) : [];
    for (const chat of new Set([MAIN, ...chats.map((chat) => chat.id)]))
      keep(chat, readBrowserJournal(chat === MAIN ? journalPath : join(data, "chats", `${chat}.jsonl`)));
  }
  const checkpoint = BrowserCheckpoint.parse({ version: 1, source: "owner-stop", id: randomUUID(), createdAt: (options.now ?? new Date()).toISOString(), journalPath, ownerPid: options.ownerPid ?? null, browsers });
  mkdirSync(options.directory, { recursive: true });
  const path = join(options.directory, "resume.json");
  writeFileSync(`${path}.next`, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
  if (existsSync(path)) renameSync(path, join(options.directory, `resume.replaced.${randomUUID()}.json`));
  renameSync(`${path}.next`, path);
  return checkpoint;
}

/** Claim once, preserving the exact owner artifact for audit even if startup fails. */
export function consumeBrowserCheckpoint(directory: string): BrowserCheckpoint | null {
  const path = join(directory, "resume.json");
  const audit = join(directory, `resume.consumed.${randomUUID()}.json`);
  try { renameSync(path, audit); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  return BrowserCheckpoint.parse(JSON.parse(readFileSync(audit, "utf8")));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) { const key = process.argv[index], value = process.argv[index + 1]; if (!key || !value || !["--journal", "--directory", "--owner-pid"].includes(key)) throw new Error("Use --journal <events.jsonl> --directory <native directory> [--owner-pid <pid>]."); values.set(key, value); }
  const journalPath = values.get("--journal"), directory = values.get("--directory");
  if (!journalPath || !directory) throw new Error("Both --journal and --directory are required.");
  const owner = values.get("--owner-pid");
  const checkpoint = snapshotBrowsers({ journalPath, directory, ...(owner ? { ownerPid: Number(owner) } : {}) });
  console.log(JSON.stringify({ checkpoint: join(resolve(directory), "resume.json"), browsers: checkpoint.browsers.length, id: checkpoint.id }));
}
