import assert from "node:assert/strict";
import { test } from "node:test";
import type { Schedule } from "@amuse/protocol";
import { whenOf, worthRunning } from "./schedules.ts";

test("a schedule's time is the user's: a cron in their zone, a one-off read on their clock", () => {
  assert.deepEqual(whenOf({ cron: "0 8 * * *" }, "Asia/Shanghai"), { ok: true, when: { kind: "repeat", cron: "0 8 * * *", timezone: "Asia/Shanghai" } });
  assert.deepEqual(whenOf({ at: "2026-10-21 08:00" }, "Asia/Shanghai"), { ok: true, when: { kind: "once", at: "2026-10-21T00:00:00.000Z" } });
  assert.deepEqual(whenOf({ cron: "0 9 * * 1", timezone: "Europe/Paris" }, "Asia/Shanghai"), { ok: true, when: { kind: "repeat", cron: "0 9 * * 1", timezone: "Europe/Paris" } });
  assert.equal(whenOf({}, "UTC").ok, false);
  assert.equal(whenOf({ cron: "0 8 * * *", at: "2026-10-21 08:00" }, "UTC").ok, false);
  assert.equal(whenOf({ at: "tomorrow" }, "UTC").ok, false);
});

test("a run waits for what it needs: new conversation, or a conversation gone quiet and a few hours since the last", () => {
  const base: Schedule = {
    kind: "schedule",
    id: "s-mem",
    at: "2026-10-21T00:00:00Z",
    title: "Memory",
    instructions: "Tidy memory",
    when: { kind: "repeat", cron: "0 * * * *", timezone: "UTC" },
    status: "active",
    next: null,
    running: true,
    last: { at: "2026-10-21T10:00:00Z", outcome: "quiet", summary: "" },
    needs: "conversation",
    preset: true,
    goal: null,
  };
  const chats = (updated: string) => [{ updated: "2026-10-20T00:00:00Z" }, { updated }];
  assert.equal(worthRunning(base, chats("2026-10-21T09:00:00Z"), "2026-10-21T11:00:00Z"), false, "nothing since the last run");
  assert.equal(worthRunning(base, chats("2026-10-21T10:30:00Z"), "2026-10-21T11:00:00Z"), true);
  assert.equal(worthRunning({ ...base, needs: null }, chats("2026-10-21T09:00:00Z"), "2026-10-21T11:00:00Z"), true, "no condition");

  const lull: Schedule = { ...base, needs: "lull" };
  assert.equal(worthRunning(lull, chats("2026-10-21T13:50:00Z"), "2026-10-21T14:00:00Z"), false, "still talking");
  assert.equal(worthRunning(lull, chats("2026-10-21T11:00:00Z"), "2026-10-21T12:00:00Z"), false, "the last run was 2 hours ago");
  assert.equal(worthRunning(lull, chats("2026-10-21T13:30:00Z"), "2026-10-21T14:00:00Z"), true);
});
