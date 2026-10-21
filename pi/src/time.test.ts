import assert from "node:assert/strict";
import { test } from "node:test";
import { timeNow } from "./tools.ts";

test("current_time tells the time on the user's clock, with the weekday and the zone", () => {
  assert.equal(
    timeNow({ time: () => ({ now: "2026-10-21T07:30:00Z", timezone: "America/Los_Angeles" }) }),
    "Now: Wednesday 2026-10-21 00:30 (America/Los_Angeles).",
  );
});
