// THROWAWAY review probe: deleted after the review.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { query } from "@amuse/db";
import { z } from "zod";
import { locate, openData } from "./data.ts";
import { sqliteChats, eventsOf } from "./journal.ts";

const ev = (seq: number, text = "hi") => JSON.stringify({ seq, event: { kind: "upserted", entity: { kind: "prompt", id: `p-${seq}`, at: "2026-10-23T12:00:00.000Z", text, timezone: "UTC", attachments: [] }, index: seq - 1 } });
const fresh = () => mkdtempSync(join(tmpdir(), "amuse-probe-"));
const count = (db: DatabaseSync, chat: string) => query(db, z.object({ n: z.number() }), "select count(*) as n from events where chat = ?", chat)[0]?.n;

test("probe: orphan side journal, existing .bak, empty journal", async () => {
  const dir = fresh();
  writeFileSync(join(dir, "events.jsonl"), "");
  writeFileSync(join(dir, "events.jsonl.bak"), "older");
  mkdirSync(join(dir, "chats"));
  writeFileSync(join(dir, "chats", "c-orphan.jsonl"), `${ev(1)}\n`);
  const log: string[] = [];
  const db = await openData(locate({ AMUSE_DATA: dir }), (m) => void log.push(m));
  console.log("files after:", readdirSync(dir), readdirSync(join(dir, "chats")));
  console.log("log:", log);
  console.log("orphan events in db:", count(db, "c-orphan"));
  db.close();
});

test("probe: rules in the oldest shape (no browser key, string site values)", async () => {
  const dir = fresh();
  writeFileSync(join(dir, "rules.json"), JSON.stringify({ apps: { gmail: { write: "allow" } }, sites: { "www.Example.com": "allow", "a.example.com": "ask", "evil.com": "deny" } }));
  const db = await openData(locate({ AMUSE_DATA: dir }), () => {});
  console.log("sites:", db.prepare("select * from site_rules").all());
  db.close();
});

test("probe: access.json without sessions (an older shape?)", async () => {
  const dir = fresh();
  writeFileSync(join(dir, "access.json"), JSON.stringify({ password: { salt: "aa", hash: "bb" } }));
  await assert.rejects(openData(locate({ AMUSE_DATA: dir }), () => {}), (e) => (console.log("access without sessions:", e instanceof Error ? e.message.slice(0, 200) : e), true));
});

test("probe: an event with a field this version does not know is stored without it", async () => {
  const dir = fresh();
  const line = JSON.parse(ev(1));
  line.event.entity.extra = "kept?";
  writeFileSync(join(dir, "events.jsonl"), `${JSON.stringify(line)}\n`);
  const db = await openData(locate({ AMUSE_DATA: dir }), () => {});
  console.log("stored:", db.prepare("select event from events").get());
  db.close();
});

test("probe: deleting a chat then appending to it", async () => {
  const dir = fresh();
  const db = await openData(locate({ AMUSE_DATA: dir }), () => {});
  const chats = sqliteChats(db);
  chats.save([{ id: "c-1", title: "", at: "2026-10-23T12:00:00.000Z", updated: "2026-10-23T12:00:00.000Z" }]);
  const j = chats.journal("c-1");
  j.append({ seq: 1, event: { kind: "activity", activity: null } });
  chats.remove("c-1");
  console.log("events left after delete:", count(db, "c-1"));
  try {
    j.append({ seq: 2, event: { kind: "activity", activity: null } });
    console.log("append after delete: ok");
  } catch (e) {
    console.log("append after delete throws:", e instanceof Error ? e.message : e);
  }
  db.close();
});

test("probe: a writer held by another process makes append throw after busy_timeout, and the gap stops the next start", async () => {
  const dir = fresh();
  const where = locate({ AMUSE_DATA: dir });
  const db = await openData(where, () => {});
  const j = sqliteChats(db).journal("main");
  j.append({ seq: 1, event: { kind: "activity", activity: null } });
  const other = new DatabaseSync(where.database);
  other.exec("begin immediate");
  const t = Date.now();
  try {
    j.append({ seq: 2, event: { kind: "activity", activity: null } });
  } catch (e) {
    console.log(`append while locked throws after ${Date.now() - t} ms:`, e instanceof Error ? e.message : e);
  }
  other.exec("rollback");
  other.close();
  j.append({ seq: 3, event: { kind: "activity", activity: null } });
  try {
    [...eventsOf(db, "main")];
  } catch (e) {
    console.log("replay after the gap:", e instanceof Error ? e.message : e);
  }
  db.close();
});

test("probe: file modes", async () => {
  const dir = fresh();
  writeFileSync(join(dir, "events.jsonl"), `${ev(1)}\n`);
  const where = locate({ AMUSE_DATA: dir });
  const db = await openData(where, () => {});
  sqliteChats(db).journal("main").append({ seq: 2, event: { kind: "activity", activity: null } });
  for (const name of readdirSync(dir)) console.log(name, (statSync(join(dir, name)).mode & 0o777).toString(8));
  db.close();
  console.log("wal gone after close:", !existsSync(`${where.database}-wal`));
});
