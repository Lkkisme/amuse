import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migratedDatabase } from "@amuse/db";
import { locate, openData } from "./data.ts";
import { defaultSchedules, sqliteDefaults } from "./defaults.ts";

test("each default is set up once, and one added later still is", async () => {
  const fresh = sqliteDefaults(await migratedDatabase());
  assert.deepEqual(fresh.setUp(), []);
  fresh.markSetUp(["memory", "skill-review"]);
  assert.deepEqual(fresh.setUp(), ["memory", "skill-review"]);
  fresh.markSetUp(["memory", "skill-review", "goals"]);
  assert.deepEqual(fresh.setUp(), ["goals", "memory", "skill-review"]);
});

test("set up before defaults were kept one by one: the first four were", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-defaults-"));
  writeFileSync(join(dir, "defaults.json"), JSON.stringify({ done: true }));
  const set = sqliteDefaults(await openData(locate({ AMUSE_DATA: dir }), () => {})).setUp();
  assert.deepEqual(
    defaultSchedules.filter((d) => !set.includes(d.key)).map((d) => d.key),
    ["goals", "skill-review"],
  );
  assert.equal(new Set(defaultSchedules.map((d) => d.key)).size, defaultSchedules.length, "keys are unique");
});
