import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applied, dataMigrations, loadMigrations, migrate, openDatabase, tempFolder } from "@amuse/db";
import { sqliteAccess } from "./access.ts";
import { locate, openData } from "./data.ts";

const cli = fileURLToPath(new URL("./admin.ts", import.meta.url));
const fixture = fileURLToPath(new URL("../../db/fixtures/0.1.0/data", import.meta.url));
const run = (...args: string[]) => execFileSync("node", [cli, ...args], { encoding: "utf8" });
const copy = () => {
  const dir = tempFolder("amuse-cli-");
  cpSync(fixture, dir, { recursive: true });
  return dir;
};

test("the dry run lists what is pending and what it touches, and changes nothing", () => {
  const dir = copy();
  const before = readdirSync(dir).sort();
  const said = run("--data", dir, "migrate", "--dry-run");
  assert.match(said, /not there yet/);
  assert.match(said, /would run 20261023100000_create_state \(SQL\):\n {2}create table chats/);
  assert.match(said, /would run 20261023100100_import_json \(TypeScript\):\n {2}import events\.jsonl \(\d+ bytes\)/);
  assert.match(said, /import chats\/c-[\w-]+\.jsonl/);
  assert.deepEqual(readdirSync(dir).sort(), before, "no database made, no file renamed");
});

test("migrate runs them; after it, the dry run has nothing to do", () => {
  const dir = copy();
  run("--data", dir, "migrate");
  assert.match(run("--data", dir, "migrate", "--dry-run"), /2 migrations applied\nNothing to run\./);
  assert.ok(existsSync(join(dir, "events.jsonl.bak")));
});

test("export writes a chat's journal as JSONL, the lines the old file held", () => {
  const dir = copy();
  run("--data", dir, "migrate");
  const lines = run("--data", dir, "export").split("\n").filter(Boolean);
  const was = readFileSync(join(dir, "events.jsonl.bak"), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, was.length);
  assert.deepEqual(lines.map((l): unknown => JSON.parse(l)), was.map((l): unknown => JSON.parse(l)));
  assert.match(run("--data", dir, "chats"), /^main\t\d+ events\t/m);
  const side = run("--data", dir, "chats").split("\n").find((l) => l.startsWith("c-"))?.split("\t")[0] ?? "";
  assert.ok(run("--data", dir, "export", side).split("\n").filter(Boolean).length > 0);
});

test("reset-password forgets the password and the sessions, and the next visit can set one", async () => {
  const dir = copy();
  run("--data", dir, "migrate");
  assert.match(run("--data", dir, "reset-password"), /forgotten/);
  const access = sqliteAccess(await openData(locate({ AMUSE_DATA: dir }), () => {}));
  assert.equal(access.ready(), false);
  assert.ok(await access.setup("a brand new password"));
});

test("without a data folder, or with an empty one, it says so, and an unknown command is usage", () => {
  const noData = spawnSync("node", [cli, "migrate"], { encoding: "utf8", env: { ...process.env, AMUSE_DATA: "", AMUSE_JOURNAL: "" } });
  assert.equal(noData.status, 2);
  assert.match(noData.stderr, /Say which data/);
  const disagree = spawnSync("node", [cli, "migrate"], { encoding: "utf8", env: { ...process.env, AMUSE_DATA: copy(), AMUSE_JOURNAL: join(copy(), "events.jsonl") } });
  assert.equal(disagree.status, 1);
  assert.match(disagree.stderr, /name different folders/);
  const bad = spawnSync("node", [cli, "--data", copy(), "frobnicate"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage:/);
});

const listing = (dir: string) => readdirSync(dir).sort();
const fails = (...args: string[]) => spawnSync("node", [cli, ...args], { encoding: "utf8" });

test("the dry run, export and chats leave an existing database exactly as it is: no -wal, no -shm, no folder, no migration", () => {
  const dir = copy();
  run("--data", dir, "migrate");
  const before = listing(dir);
  run("--data", dir, "migrate", "--dry-run");
  assert.deepEqual(listing(dir), before);
  run("--data", dir, "export");
  run("--data", dir, "chats");
  assert.deepEqual(listing(dir), before);
});

test("export, chats and reset-password refuse when migrations are pending, and do not run them", async () => {
  const dir = tempFolder("amuse-pending-");
  const db = openDatabase(join(dir, "amuse.db"));
  const known = await loadMigrations(dataMigrations);
  await migrate(db, known.slice(0, 1), { backups: join(dir, "backups"), context: { dataDir: dir, journal: join(dir, "events.jsonl"), log: () => {} } });
  db.close();
  for (const command of ["export", "chats", "reset-password"]) {
    const result = fails("--data", dir, command);
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /1 migration is pending: run `amuse-admin migrate` first/, command);
  }
  const after = openDatabase(join(dir, "amuse.db"));
  assert.deepEqual(applied(after), ["20261023100000"]);
  after.close();
  assert.equal(existsSync(join(dir, "backups")), false, "nothing was copied or made");
});

test("rollback asks for --yes, copies the database first, and never applies what is pending", async () => {
  const dir = tempFolder("amuse-rollback-");
  const db = openDatabase(join(dir, "amuse.db"));
  const known = await loadMigrations(dataMigrations);
  await migrate(db, known.slice(0, 1), { backups: join(dir, "backups"), context: { dataDir: dir, journal: join(dir, "events.jsonl"), log: () => {} } });
  db.close();
  const without = fails("--data", dir, "rollback");
  assert.equal(without.status, 2);
  assert.match(without.stderr, /Run it again with --yes/);
  const still = openDatabase(join(dir, "amuse.db"));
  assert.deepEqual(applied(still), ["20261023100000"], "not undone without --yes");
  still.close();
  assert.match(run("--data", dir, "rollback", "--yes"), /a copy of the database is .*pre-rollback\.db\nundid 20261023100000_create_state/);
  assert.equal(readdirSync(join(dir, "backups")).filter((n) => n.endsWith("-pre-rollback.db")).length, 1);
  const done = openDatabase(join(dir, "amuse.db"));
  assert.deepEqual(applied(done), [], "undone, and the second migration was not run on the way");
  done.close();
});

test("rollback of a migration with no way back changes nothing and makes no copy", () => {
  const dir = copy();
  run("--data", dir, "migrate");
  const result = fails("--data", dir, "rollback", "--yes");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has no way back/);
  assert.equal(readdirSync(join(dir, "backups")).length, 0);
});

test("retire-old-files finishes an interrupted rename, once what is there is exactly what was imported", async () => {
  const dir = copy();
  run("--data", dir, "migrate");
  renameSync(join(dir, "events.jsonl.bak"), join(dir, "events.jsonl"));
  renameSync(join(dir, "access.json.bak"), join(dir, "access.json"));
  const stopped = fails("--data", dir, "migrate");
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /old data files/);
  assert.match(run("--data", dir, "retire-old-files"), /renamed access\.json to access\.json\.bak\nrenamed events\.jsonl to events\.jsonl\.bak|renamed events\.jsonl to events\.jsonl\.bak\nrenamed access\.json to access\.json\.bak/);
  assert.match(run("--data", dir, "migrate"), /up to date/);
  // an older version's password is not what was imported: it stays, and the start stays refused
  writeFileSync(join(dir, "access.json"), "{}");
  const kept = fails("--data", dir, "retire-old-files");
  assert.equal(kept.status, 1);
  assert.match(kept.stderr, /kept access\.json/);
  assert.match(kept.stderr, /move them into a folder of their own/);
  assert.doesNotMatch(kept.stderr, /backups folder/);
  assert.equal(readFileSync(join(dir, "access.json"), "utf8"), "{}");
  assert.equal(fails("--data", dir, "migrate").status, 1);
});

test("retire-old-files says the name it really gave the file, when .bak was taken", () => {
  const dir = copy();
  run("--data", dir, "migrate");
  renameSync(join(dir, "events.jsonl.bak"), join(dir, "events.jsonl"));
  writeFileSync(join(dir, "events.jsonl.bak"), "an earlier import's file");
  assert.match(run("--data", dir, "retire-old-files"), /renamed events\.jsonl to events\.jsonl\.bak\.2/);
  assert.equal(readFileSync(join(dir, "events.jsonl.bak"), "utf8"), "an earlier import's file");
});
