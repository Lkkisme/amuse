import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentIO, type Say, type Timers, createHost } from "@amuse/core";
import { type Db, migratedDatabase, openDatabase, query, tempFolder } from "@amuse/db";
import { demoPorts } from "@amuse/demo";
import { MAIN } from "@amuse/protocol";
import { z } from "zod";
import { sqliteChats } from "./journal.ts";

const idle: Timers<number> = { set: () => 0, clear: () => {} };
const events = (db: Db, chat: string) => query(db, z.object({ n: z.number() }), "select count(*) as n from events where chat = ?", chat)[0]?.n;
const seqs = (db: Db, chat: string) => query(db, z.object({ seq: z.number() }), "select seq from events where chat = ? order by seq", chat).map((r) => r.seq);

/** Ports that hand over each chat's AgentIO, so a test can speak as its agent. */
function agents() {
  const held = new Map<string, AgentIO>();
  return { ports: { ...demoPorts(idle), prompt: (_turn: unknown, agent: AgentIO) => void held.set(agent.chat, agent) }, held };
}

test("what a deleted chat's agent still says goes nowhere: it does not throw, and nothing is written for the chat", async () => {
  const db = await migratedDatabase();
  const { ports, held } = agents();
  const host = createHost(ports, { store: sqliteChats(db), timers: idle });
  const side = await host.call("chats.create", {});
  await host.call("chat.send", { chat: side.id, text: "think about this", timezone: "UTC", attachments: [] });
  const agent = held.get(side.id);
  assert.ok(agent);
  await host.call("chats.delete", { id: side.id });
  assert.equal(events(db, side.id), 0);
  // the turn's last words, after the chat is gone (the lane's `finally`), and a reply
  assert.doesNotThrow(() => agent.emit({ kind: "activity", activity: null }));
  assert.doesNotThrow(() => agent.emit({ kind: "upserted", entity: { kind: "reply", id: "r-late", at: "2026-10-23T00:00:00.000Z", text: "too late", streaming: false, attachments: [], suggestions: [], chosen: null } }));
  assert.equal(events(db, side.id), 0);
  assert.deepEqual(sqliteChats(db).load().map((c) => c.id), [MAIN]);
});

test("an event the journal cannot take is not recorded, so the next one is numbered the same and the journal has no gap; a restart replays", async () => {
  const dir = tempFolder("amuse-emit-");
  const db = await migratedDatabase(dir);
  const { ports, held } = agents();
  const host = createHost(ports, { store: sqliteChats(db), timers: idle });
  await host.call("chat.send", { chat: MAIN, text: "one", timezone: "UTC", attachments: [] });
  const agent = held.get(MAIN);
  assert.ok(agent);
  const before = seqs(db, MAIN);
  const reply = (id: string): Say => ({ kind: "upserted", entity: { kind: "reply", id, at: "2026-10-23T00:00:00.000Z", text: id, streaming: false, attachments: [], suggestions: [], chosen: null } });

  // another connection holds the write lock; this one does not wait for it
  const other = openDatabase(join(dir, "amuse.db"));
  other.exec("begin immediate");
  db.exec("pragma busy_timeout = 0");
  assert.throws(() => agent.emit(reply("r-lost")), /locked|busy/i);
  assert.deepEqual(seqs(db, MAIN), before, "nothing was written");
  other.exec("rollback");
  other.close();

  // the lock is gone: the next event takes the number the lost one would have had
  agent.emit(reply("r-kept"));
  const after = seqs(db, MAIN);
  assert.deepEqual(after, [...before, before.length + 1]);
  const state = await host.call("session.sync", { chat: MAIN, since: null });
  assert.ok(state.kind === "snapshot" && state.state.seq === before.length + 1, "what the host knows is what the journal has");
  assert.ok(state.kind === "snapshot" && !state.state.entities.some((e) => e.id === "r-lost") && state.state.entities.some((e) => e.id === "r-kept"));

  // and the next start reads it all
  db.close();
  const restarted = createHost(demoPorts(idle), { store: sqliteChats(await migratedDatabase(dir)), timers: idle });
  const replayed = await restarted.call("session.sync", { chat: MAIN, since: null });
  assert.ok(replayed.kind === "snapshot" && replayed.state.entities.some((e) => e.id === "r-kept"));
});
