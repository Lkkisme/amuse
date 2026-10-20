import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHost, demoPorts, seed, type Timers } from "@remuse/core";
import { fileJournal } from "./journal.ts";

const idle: Timers<number> = { set: () => 0, clear: () => {} };
const snapshot = async (host: ReturnType<typeof createHost>) => {
  const r = await host.call("session.sync", { since: null });
  assert.ok(r.kind === "snapshot");
  return r.state;
};

test("a restarted host comes back with the same state and keeps counting", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "remuse-journal-")), "log", "events.jsonl");
  const first = createHost(demoPorts(idle), { seed: seed(), journal: fileJournal(path) });
  await first.call("chat.send", { text: "remember me" });
  const before = await snapshot(first);
  assert.equal((statSync(path).mode & 0o777).toString(8), "600");

  const second = createHost(demoPorts(idle), { seed: seed(), journal: fileJournal(path) });
  const replayed = await snapshot(second);
  assert.deepEqual(replayed.entities, before.entities); // replayed, not re-seeded
  assert.equal(before.activity?.kind, "responding"); // the first run was cut off mid-reply…
  assert.equal(replayed.activity, null); // …so recovery cleared it
  assert.equal(replayed.seq, before.seq + 1);
  const { id } = await second.call("chat.send", { text: "and this" });
  const after = await snapshot(second);
  assert.ok(after.seq > before.seq);
  assert.equal(after.entities.at(-1)?.id, id);
});

test("a torn last line is dropped, not replayed", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "remuse-journal-")), "events.jsonl");
  const host = createHost(demoPorts(idle), { seed: seed(), journal: fileJournal(path) });
  const seq = (await snapshot(host)).seq;
  appendFileSync(path, '{"seq":');
  assert.equal(fileJournal(path).load().length, seq);
});
