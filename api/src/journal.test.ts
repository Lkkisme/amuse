import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type ChatStore, type Journal, createHost, memoryChats, type Timers } from "@amuse/core";
import { migratedDatabase, query, readJournalFile } from "@amuse/db";
import { demoPorts, seed } from "@amuse/demo";
import { type Envelope, MAIN, apply, empty } from "@amuse/protocol";
import { z } from "zod";
import { locate, openData } from "./data.ts";
import { eventsOf, exported, sqliteChats } from "./journal.ts";

const idle: Timers<number> = { set: () => 0, clear: () => {} };
const clock = { now: () => "2026-10-23T00:00:00.000Z" };
const snapshot = async (host: ReturnType<typeof createHost>, chat = MAIN) => {
  const r = await host.call("session.sync", { chat, since: null });
  assert.ok(r.kind === "snapshot");
  return r.state;
};
const dataFolder = () => mkdtempSync(join(tmpdir(), "amuse-journal-"));

test("a restarted host comes back with the same state and keeps counting", async () => {
  const dir = dataFolder();
  const first = createHost(demoPorts(idle), { seed: seed(), store: sqliteChats(await openData(locate({ AMUSE_DATA: dir }), () => {})), timers: idle });
  await first.call("chat.send", { chat: "main", text: "remember me", timezone: "UTC", attachments: [] });
  const before = await snapshot(first);

  const second = createHost(demoPorts(idle), { seed: seed(), store: sqliteChats(await openData(locate({ AMUSE_DATA: dir }), () => {})), timers: idle });
  const replayed = await snapshot(second);
  assert.deepEqual(
    replayed.entities.map((e) => e.id),
    before.entities.map((e) => e.id),
  ); // replayed, not re-seeded
  assert.equal(before.activity?.kind, "responding"); // the first run was cut off mid-reply…
  assert.equal(replayed.activity, null); // …so recovery cleared it, and settled what was in flight:
  for (const e of replayed.entities) {
    if (e.kind === "browser") assert.ok(["completed", "failed", "stopped"].includes(e.status), `${e.id} ${e.status}`);
    if (e.kind === "approval") assert.notEqual(e.status, "pending");
    if (e.kind === "task") assert.ok(!["queued", "working", "waiting"].includes(e.status));
  }
  const { id } = await second.call("chat.send", { chat: "main", text: "and this", timezone: "UTC", attachments: [] });
  const after = await snapshot(second);
  assert.ok(after.seq > before.seq);
  assert.equal(after.entities.at(-1)?.id, id);
});

test("a row it cannot read stops the load, and the data is left as it was", async () => {
  const db = await migratedDatabase();
  createHost(demoPorts(idle), { seed: seed(), store: sqliteChats(db), timers: idle });
  const rows = () => query(db, z.object({ n: z.number() }), "select count(*) as n from events")[0]?.n;
  const count = rows();
  db.prepare("insert into events (chat, seq, event) values (?, ?, ?)").run(MAIN, (count ?? 0) + 2, '{"kind":"renamed"}'); // a gap, and not an event
  assert.throws(() => createHost(demoPorts(idle), { store: sqliteChats(db), timers: idle }), /is not the next event/);
  assert.equal(rows(), (count ?? 0) + 1);
});

test("the journal is append-only in effect: an event cannot be written twice", async () => {
  const db = await migratedDatabase();
  const journal = sqliteChats(db).journal(MAIN);
  journal.append({ seq: 1, event: { kind: "activity", activity: null } });
  assert.throws(() => journal.append({ seq: 1, event: { kind: "activity", activity: null } }), /constraint/i);
});

test("side chats are kept with the main chat, and a deleted one's events go with it", async () => {
  const dir = dataFolder();
  const first = createHost(demoPorts(idle), { store: sqliteChats(await openData(locate({ AMUSE_DATA: dir }), () => {})), timers: idle });
  const side = await first.call("chats.create", {});
  await first.call("chat.send", { chat: side.id, text: "a side thought", timezone: "UTC", attachments: [] });

  const db = await openData(locate({ AMUSE_DATA: dir }), () => {});
  const second = createHost(demoPorts(idle), { store: sqliteChats(db), timers: idle });
  const synced = await second.call("session.sync", { chat: side.id, since: null });
  assert.ok(synced.kind === "snapshot" && synced.state.entities.some((e) => e.kind === "prompt" && e.text === "a side thought"));
  const events = (chat: string) => query(db, z.object({ n: z.number() }), "select count(*) as n from events where chat = ?", chat)[0]?.n;
  assert.ok((events(side.id) ?? 0) > 0);
  await second.call("chats.delete", { id: side.id });
  assert.equal(events(side.id), 0);
  assert.deepEqual(sqliteChats(db).load().map((c) => c.id), [MAIN]);
});

test("the journal is read as it is replayed, not loaded whole", async () => {
  const db = await migratedDatabase();
  const journal = sqliteChats(db).journal(MAIN);
  for (let seq = 1; seq <= 3; seq++) journal.append({ seq, event: { kind: "activity", activity: null } });
  const loaded = journal.load();
  assert.ok(!Array.isArray(loaded), "a lazy sequence, not a list");
  const iterator = loaded[Symbol.iterator]();
  assert.equal(iterator.next().value?.seq, 1);
  // and from a point on, for whoever reads on demand
  assert.deepEqual([...eventsOf(db, MAIN, 1)].map((e) => e.seq), [2, 3]);
});

/** The old journal files, as the previous version wrote them: appended to a JSONL file, one event a line, replayed from it. */
function jsonlChats(dir: string): ChatStore {
  const base = memoryChats();
  mkdirSync(join(dir, "chats"), { recursive: true });
  const path = (chat: string) => (chat === MAIN ? join(dir, "events.jsonl") : join(dir, "chats", `${chat}.jsonl`));
  const read = (chat: string): Envelope[] => {
    const log: Envelope[] = [];
    try {
      readJournalFile(path(chat), (e) => void log.push(e));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return log;
  };
  return {
    load: () => JSON.parse(readChats(dir)),
    save: (chats) => {
      base.save(chats);
      writeFileSync(join(dir, "chats.json"), JSON.stringify(chats, null, 2));
    },
    journal: (chat): Journal => ({ load: () => read(chat), append: (e) => appendFileSync(path(chat), `${JSON.stringify(e)}\n`) }),
    remove: () => {},
  };
}
import { existsSync, readFileSync } from "node:fs";
const readChats = (dir: string) => (existsSync(join(dir, "chats.json")) ? readFileSync(join(dir, "chats.json"), "utf8") : "[]");

test("replay equivalence: the state from the JSONL files is the state from SQLite, event for event", async () => {
  // a real host run writes the old files (a main chat, a side chat, a rule-asking exchange)
  const dir = dataFolder();
  const old = createHost(demoPorts(idle), { seed: seed(), store: jsonlChats(dir), timers: idle, clock });
  await old.call("chat.send", { chat: "main", text: "plan my week", timezone: "UTC", attachments: [] });
  const side = await old.call("chats.create", {});
  await old.call("chat.send", { chat: side.id, text: "a side thought", timezone: "UTC", attachments: [] });
  await old.call("chat.send", { chat: "main", text: "and also this", timezone: "UTC", attachments: [] });

  // a host restarted from the files
  const restartedFromFiles = createHost(demoPorts(idle), { seed: seed(), store: jsonlChats(dir), timers: idle, clock });
  const files = { main: await snapshot(restartedFromFiles), side: await snapshot(restartedFromFiles, side.id), chats: await restartedFromFiles.call("chats.list", {}) };

  // the state as folding the files' events gives it (the restart wrote its recovery into them, as it does)
  const folded = (chat: string) => {
    let state = empty;
    readJournalFile(chat === MAIN ? join(dir, "events.jsonl") : join(dir, "chats", `${chat}.jsonl`), (e) => void (state = apply(state, e)));
    return state;
  };
  const fromFiles = { main: folded(MAIN), side: folded(side.id) };
  // the same files, imported
  const db = await openData(locate({ AMUSE_DATA: dir }), () => {});
  const fromSql = (chat: string) => [...eventsOf(db, chat)].reduce(apply, empty);
  assert.deepEqual(fromSql(MAIN), fromFiles.main);
  assert.deepEqual(fromSql(side.id), fromFiles.side);
  const restartedFromSql = createHost(demoPorts(idle), { seed: seed(), store: sqliteChats(db), timers: idle, clock });
  assert.deepEqual(await snapshot(restartedFromSql), files.main);
  assert.deepEqual(await snapshot(restartedFromSql, side.id), files.side);
  assert.deepEqual(await restartedFromSql.call("chats.list", {}), files.chats);
  // and exported again, the journal is the same events the old file held (keys in the schema's order; the restart added its recovery after them)
  const lines = (text: string) => text.split("\n").filter(Boolean).map((line): unknown => JSON.parse(line));
  const was = lines(readFileSync(join(dir, "events.jsonl.bak"), "utf8"));
  assert.deepEqual(lines([...exported(db, MAIN)].join("")).slice(0, was.length), was);
});
