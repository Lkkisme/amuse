import assert from "node:assert/strict";
import { test } from "node:test";
import { whenOf } from "./schedules.ts";

test("a schedule's time is the user's: a cron in their zone, a one-off read on their clock", () => {
  assert.deepEqual(whenOf({ cron: "0 8 * * *" }, "Asia/Shanghai"), { ok: true, when: { kind: "repeat", cron: "0 8 * * *", timezone: "Asia/Shanghai" } });
  assert.deepEqual(whenOf({ at: "2026-10-21 08:00" }, "Asia/Shanghai"), { ok: true, when: { kind: "once", at: "2026-10-21T00:00:00.000Z" } });
  assert.deepEqual(whenOf({ cron: "0 9 * * 1", timezone: "Europe/Paris" }, "Asia/Shanghai"), { ok: true, when: { kind: "repeat", cron: "0 9 * * 1", timezone: "Europe/Paris" } });
  assert.equal(whenOf({}, "UTC").ok, false);
  assert.equal(whenOf({ cron: "0 8 * * *", at: "2026-10-21 08:00" }, "UTC").ok, false);
  assert.equal(whenOf({ at: "tomorrow" }, "UTC").ok, false);
});
