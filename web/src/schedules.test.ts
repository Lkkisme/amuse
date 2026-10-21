import assert from "node:assert/strict";
import { test } from "node:test";
import { repeats } from "./schedules.ts";

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

test("a schedule says when it runs: daily at a set hour, or every hour at a minute", () => {
  assert.equal(repeats({ kind: "repeat", cron: "0 3 * * *", timezone: zone }), "Every day at 03:00 AM");
  assert.equal(repeats({ kind: "repeat", cron: "30 * * * *", timezone: zone }), "At 30 minutes past the hour");
  assert.equal(repeats({ kind: "repeat", cron: "0 * * * *", timezone: zone }), "Every hour");
});
