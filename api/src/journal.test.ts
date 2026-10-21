import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createHost, type Timers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import { fileChats, fileJournal } from "./journal.ts";

const idle: Timers<number> = { set: () => 0, clear: () => {} };
const snapshot = async (host: ReturnType<typeof createHost>) => {
  const r = await host.call("session.sync", { chat: "main", since: null });
  assert.ok(r.kind === "snapshot");
  return r.state;
};

test("a restarted host comes back with the same state and keeps counting", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "remuse-journal-")), "log", "events.jsonl");
  const first = createHost(demoPorts(idle), { seed: seed(), store: fileChats(dirname(path), path), timers: idle });
  await first.call("chat.send", { chat: "main", text: "remember me", timezone: "UTC", attachments: [] });
  const before = await snapshot(first);
  assert.equal((statSync(path).mode & 0o777).toString(8), "600");

  const second = createHost(demoPorts(idle), { seed: seed(), store: fileChats(dirname(path), path), timers: idle });
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

test("a torn last line is dropped and cut off, so the next append starts clean", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "remuse-journal-")), "events.jsonl");
  const host = createHost(demoPorts(idle), { seed: seed(), store: fileChats(dirname(path), path), timers: idle });
  const seq = (await snapshot(host)).seq;
  appendFileSync(path, '{"seq":');
  const journal = fileJournal(path);
  assert.equal(journal.load().length, seq);
  journal.append({ seq: seq + 1, event: { kind: "activity", activity: null } });
  assert.equal(fileJournal(path).load().length, seq + 1);
});

test("a whole line it cannot read stops the load, and the file is left as it was", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "remuse-journal-")), "events.jsonl");
  const host = createHost(demoPorts(idle), { seed: seed(), store: fileChats(dirname(path), path), timers: idle });
  await snapshot(host);
  appendFileSync(path, '{"seq":999,"event":{"kind":"renamed"}}\n');
  const before = readFileSync(path);
  assert.throws(() => fileJournal(path).load(), /line \d+ is not the next event/);
  assert.deepEqual(readFileSync(path), before);
});

test("side chats are kept beside the main chat's log, and a deleted one's log goes with it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remuse-chats-"));
  const main = join(dir, "events.jsonl");
  const first = createHost(demoPorts(idle), { store: fileChats(dir, main), timers: idle });
  const side = await first.call("chats.create", {});
  await first.call("chat.send", { chat: side.id, text: "a side thought", timezone: "UTC", attachments: [] });
  const log = join(dir, "chats", `${side.id}.jsonl`);
  assert.equal((statSync(log).mode & 0o777).toString(8), "600");
  assert.equal((statSync(join(dir, "chats.json")).mode & 0o777).toString(8), "600");

  const second = createHost(demoPorts(idle), { store: fileChats(dir, main), timers: idle });
  const synced = await second.call("session.sync", { chat: side.id, since: null });
  assert.ok(synced.kind === "snapshot" && synced.state.entities.some((e) => e.kind === "prompt" && e.text === "a side thought"));
  await second.call("chats.delete", { id: side.id });
  assert.throws(() => statSync(log));
  assert.throws(() => fileChats(dir, main).journal("../events"), /not a chat id/);
});
