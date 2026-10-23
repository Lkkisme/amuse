import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Problem, StartupError, query } from "@amuse/db";
import { z } from "zod";
import { locate, openData, openExisting } from "./data.ts";

const fixture = fileURLToPath(new URL("../../db/fixtures/0.1.0/data", import.meta.url));
const folder = () => mkdtempSync(join(tmpdir(), "amuse-data-test-"));
const problemOf = async (work: () => unknown): Promise<Problem | null> => {
  try {
    await work();
  } catch (error) {
    if (error instanceof StartupError) return error.problem;
    throw error;
  }
  return null;
};

test("where the data is: AMUSE_DATA, or AMUSE_JOURNAL's folder, and never two different folders", async () => {
  const dir = folder();
  assert.equal(locate({ AMUSE_DATA: dir }).dir, dir);
  assert.equal(locate({ AMUSE_DATA: dir }).journal, join(dir, "events.jsonl"));
  assert.equal(locate({ AMUSE_JOURNAL: join(dir, "old.jsonl") }).dir, dir);
  assert.equal(locate({ AMUSE_JOURNAL: join(dir, "old.jsonl") }).journal, join(dir, "old.jsonl"));
  assert.equal(locate({ AMUSE_DATA: dir, AMUSE_JOURNAL: join(dir, "old.jsonl") }).dir, dir, "they agree");
  assert.equal(locate({ AMUSE_DATA: dir, AMUSE_JOURNAL: "" }).dir, dir, "an empty journal is none");
  assert.ok(locate({}).dir.startsWith(tmpdir()), "with neither, a temporary folder");
  assert.deepEqual(await problemOf(() => locate({ AMUSE_DATA: "" })), { kind: "configuration", trouble: "empty-data" });
  assert.deepEqual(await problemOf(() => locate({ AMUSE_DATA: "", AMUSE_JOURNAL: join(dir, "old.jsonl") })), { kind: "configuration", trouble: "empty-data" });
  assert.deepEqual(await problemOf(() => locate({ AMUSE_DATA: dir, AMUSE_JOURNAL: join(folder(), "events.jsonl") })), { kind: "configuration", trouble: "folders-differ" });
});

test("the old files are read from the journal's folder: with AMUSE_JOURNAL set they are imported from there", async () => {
  const dir = folder();
  cpSync(fixture, dir, { recursive: true });
  renameSync(join(dir, "events.jsonl"), join(dir, "main-log.jsonl")); // an older setup that named its journal otherwise
  const db = await openData(locate({ AMUSE_JOURNAL: join(dir, "main-log.jsonl") }), () => {});
  assert.ok((query(db, z.object({ n: z.number() }), "select count(*) as n from events where chat = 'main'")[0]?.n ?? 0) > 0);
  assert.ok(existsSync(join(dir, "main-log.jsonl.bak")));
  assert.ok(existsSync(join(dir, "access.json.bak")));
});

test("old files beside a database that has already imported them stop the start, in words, and are never read", async () => {
  const dir = folder();
  cpSync(fixture, dir, { recursive: true });
  const where = locate({ AMUSE_DATA: dir });
  (await openData(where, () => {})).close();
  // a crash between the commit and the rename
  renameSync(join(dir, "access.json.bak"), join(dir, "access.json"));
  const problem = await problemOf(() => openData(where, () => {}));
  assert.deepEqual(problem, { kind: "old-files", files: ["access.json"] });
  // an older version run on this volume starts empty, and writes its own files
  writeFileSync(join(dir, "events.jsonl"), "");
  assert.deepEqual(await problemOf(() => openData(where, () => {})), { kind: "old-files", files: ["events.jsonl", "access.json"] });
  assert.equal(readFileSync(join(dir, "events.jsonl"), "utf8"), "", "left as they are");
});

test("the commands that only look open the database as it is: they make nothing, check nothing, and refuse when something is pending", async () => {
  const dir = folder();
  const where = locate({ AMUSE_DATA: dir });
  await assert.rejects(openExisting(where), /There is no database/);
  assert.equal(existsSync(join(dir, "amuse.db")), false, "not made");
  assert.equal(existsSync(join(dir, "backups")), false, "no folder made");
  (await openData(where, () => {})).close();
  (await openExisting(where)).close();
});
