import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSchedules, fileDefaults } from "./defaults.ts";

test("each default is set up once, and one added later still is", () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-defaults-"));
  const fresh = fileDefaults(join(dir, "fresh.json"));
  assert.deepEqual(fresh.setUp(), []);
  fresh.markSetUp(["memory", "skill-review"]);
  assert.deepEqual(fresh.setUp(), ["memory", "skill-review"]);

  // set up before defaults were kept one by one: the first four were
  const older = join(dir, "older.json");
  writeFileSync(older, JSON.stringify({ done: true }));
  const set = fileDefaults(older).setUp();
  assert.deepEqual(
    defaultSchedules.filter((d) => !set.includes(d.key)).map((d) => d.key),
    ["skill-review"],
  );
  assert.equal(new Set(defaultSchedules.map((d) => d.key)).size, defaultSchedules.length, "keys are unique");
});
