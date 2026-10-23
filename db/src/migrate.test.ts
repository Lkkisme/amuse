import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Context, loadMigrations, parseSql, touchedBy } from "./migrations.ts";
import { applied, describePending, migrate, plan, revert, snapshot } from "./migrate.ts";
import { MEMORY, openDatabase, query, transaction } from "./open.ts";
import { StartupError } from "./problem.ts";

const folder = () => mkdtempSync(join(tmpdir(), "amuse-runner-"));
const context = (dir: string): Omit<Context, "db"> => ({ dataDir: dir, journal: join(dir, "events.jsonl"), log: () => {} });
const tables = (db: DatabaseSync) => query(db, z.object({ name: z.string() }), "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").map((r) => r.name);

/** A folder of migrations: SQL files as given, and TypeScript ones from their source. */
function migrationsIn(files: Record<string, string>): string {
  const dir = folder();
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const sql = (up: string, down = "") => `-- migrate:up\n${up}\n\n-- migrate:down\n${down}\n`;

test("dbmate's file format: the up and down sections, comments before them, and what it refuses", () => {
  assert.deepEqual(parseSql("a.sql", "-- the first\n-- migrate:up\ncreate table a (x);\n-- migrate:down\ndrop table a;\n"), { up: "create table a (x);", down: "drop table a;" });
  assert.deepEqual(parseSql("a.sql", "-- migrate:up\ncreate table a (x);\n"), { up: "create table a (x);", down: null });
  assert.throws(() => parseSql("a.sql", "create table a (x);"), /must begin with "-- migrate:up"/);
  assert.throws(() => parseSql("a.sql", "-- migrate:down\ndrop table a;\n-- migrate:up\nselect 1;"), /must begin with/);
  assert.throws(() => parseSql("a.sql", "-- migrate:up\n-- migrate:down\nselect 1;"), /migrate:up section is empty/);
  assert.throws(() => parseSql("a.sql", "-- migrate:up transaction:false\nselect 1;"), /transaction:false is not supported/);
  assert.throws(() => parseSql("a.sql", "-- migrate:up\nselect 1;\n-- migrate:up\nselect 2;"), /appears twice/);
});

test("what a migration touches, from its SQL", () => {
  assert.deepEqual(touchedBy("-- note\ncreate table if not exists chats (id);\nalter table chats add column x;\ninsert or ignore into chats values (1);\ncreate unique index i on chats (id);\nupdate sessions set x = 1;\ndelete from events;\ndrop table old;"), [
    "create table chats",
    "alter table chats",
    "insert or ignore into chats",
    "create unique index i",
    "update sessions",
    "delete from events",
    "drop table old",
  ]);
});

test("the sequence: SQL and TypeScript migrations run in one order, whatever their file names sort as", async () => {
  const dir = migrationsIn({
    "20260101000200_third.sql": sql("create table c (x);"),
    "20260101000100_second.ts": `
      export const describe = () => ["second, in code"];
      export const up = ({ db }) => { db.exec("create table b (x)"); db.prepare("insert into b values (?)").run("from code"); };
      export const down = ({ db }) => db.exec("drop table b");`,
    "20260101000000_first.sql": sql("create table a (x);", "drop table a;"),
    "notes.txt": "not a migration",
  });
  const known = await loadMigrations(dir);
  assert.deepEqual(known.map((m) => `${m.version}_${m.name}:${m.kind}`), ["20260101000000_first:sql", "20260101000100_second:code", "20260101000200_third:sql"]);
  const db = openDatabase(MEMORY);
  const report = await migrate(db, known, { backups: join(dir, "backups"), context: context(dir) });
  assert.equal(report.ran.length, 3);
  assert.deepEqual(tables(db), ["a", "b", "c", "schema_migrations"]);
  assert.deepEqual(applied(db), ["20260101000000", "20260101000100", "20260101000200"]);
  assert.equal(query(db, z.object({ x: z.string() }), "select x from b")[0]?.x, "from code");
  // dbmate's own table, in dbmate's own shape
  assert.match(query(db, z.object({ sql: z.string() }), "select sql from sqlite_master where name = 'schema_migrations'")[0]?.sql ?? "", /version varchar\(255\) primary key/i);
  // nothing pending now
  assert.equal((await migrate(db, known, { backups: join(dir, "backups"), context: context(dir) })).ran.length, 0);
});

test("files that are not a migration's by name, and two with one version, are errors", async () => {
  await assert.rejects(loadMigrations(migrationsIn({ "init.sql": sql("select 1;") })), /named <14-digit version>_<name>/);
  await assert.rejects(loadMigrations(migrationsIn({ "20260101000000_a.sql": sql("select 1;"), "20260101000000_b.sql": sql("select 1;") })), /two migrations have the version/);
  await assert.rejects(loadMigrations(migrationsIn({ "20260101000000_a.ts": "export const up = () => {};" })), /exports up\(context\) and describe\(context\)/);
});

test("a migration that fails is rolled back whole, the version is not recorded, and the start stops with the step named", async () => {
  const dir = migrationsIn({
    "20260101000000_ok.sql": sql("create table ok (x);"),
    "20260101000100_bad.sql": sql("create table half (x);\ninsert into half values (1);\ninsert into absent_table values (1);"),
    "20260101000200_never.sql": sql("create table never (x);"),
  });
  const db = openDatabase(MEMORY);
  await assert.rejects(migrate(db, await loadMigrations(dir), { backups: join(dir, "backups"), context: context(dir) }), (error) => {
    assert.ok(error instanceof StartupError);
    assert.equal(error.problem.kind, "migration-failed");
    assert.ok(error.problem.kind === "migration-failed" && error.problem.version === "20260101000100" && error.problem.name === "bad" && /no such table/.test(error.problem.message));
    return true;
  });
  assert.deepEqual(applied(db), ["20260101000000"], "the one before it stays: it was whole");
  assert.deepEqual(tables(db), ["ok", "schema_migrations"], "nothing of the failed one, and the one after it never ran");
});

test("a code migration that throws midway leaves nothing behind", async () => {
  const dir = migrationsIn({
    "20260101000000_import.ts": `
      export const describe = () => [];
      export const up = ({ db }) => { db.exec("create table t (x)"); db.exec("insert into t values (1)"); throw new Error("the file was torn"); };`,
  });
  const db = openDatabase(MEMORY);
  await assert.rejects(migrate(db, await loadMigrations(dir), { backups: join(dir, "backups"), context: context(dir) }), /the file was torn/);
  assert.deepEqual(tables(db), ["schema_migrations"]);
  assert.deepEqual(applied(db), []);
});

test("work after the commit runs after it; if it fails the migration still stands, and is said", async () => {
  const dir = migrationsIn({
    "20260101000000_a.ts": `
      export const describe = () => [];
      export const up = ({ db }) => { db.exec("create table t (x)"); return () => { throw new Error("rename failed"); }; };`,
  });
  const db = openDatabase(MEMORY);
  const said: string[] = [];
  const report = await migrate(db, await loadMigrations(dir), { backups: join(dir, "backups"), context: { ...context(dir), log: (m) => void said.push(m) } });
  assert.equal(report.ran.length, 1);
  assert.deepEqual(applied(db), ["20260101000000"]);
  assert.ok(said.some((m) => /last step failed: rename failed/.test(m)));
});

test("a database from a newer Amuse is refused, with the version it needs, and left alone", async () => {
  const dir = migrationsIn({ "20260101000000_a.sql": sql("create table a (x);") });
  const known = await loadMigrations(dir);
  const db = openDatabase(MEMORY);
  await migrate(db, known, { backups: join(dir, "backups"), context: context(dir) });
  db.prepare("insert into schema_migrations (version) values (?)").run("20270101000000");
  await assert.rejects(migrate(db, known, { backups: join(dir, "backups"), context: context(dir) }), (error) => {
    assert.ok(error instanceof StartupError);
    assert.deepEqual(error.problem, { kind: "database-newer", needed: "20270101000000", known: "20260101000000" });
    return true;
  });
  assert.deepEqual(readdirSync(dir).filter((n) => n === "backups"), [], "no backup was made for a refusal");
});

test("the dry run says what is pending and what it touches, and changes nothing", async () => {
  const dir = migrationsIn({
    "20260101000000_a.sql": sql("create table a (x);"),
    "20260101000100_b.ts": `export const describe = () => ["rewrites the notes"]; export const up = ({ db }) => { db.exec("create table b (x)"); };`,
  });
  const known = await loadMigrations(dir);
  const db = openDatabase(MEMORY);
  const found = plan(applied(db), known);
  assert.deepEqual(describePending(found, context(dir)), [
    { version: "20260101000000", name: "a", kind: "sql", touches: ["create table a"] },
    { version: "20260101000100", name: "b", kind: "code", touches: ["rewrites the notes"] },
  ]);
  assert.deepEqual(tables(db), [], "not even schema_migrations is made");
});

test("before pending migrations run on a database that has data, an online copy is made (mode 600); a new database needs none", async () => {
  const dir = migrationsIn({ "20260101000000_a.sql": sql("create table a (x);"), "20260101000100_b.sql": sql("create table b (x);") });
  const [first, second] = await loadMigrations(dir);
  assert.ok(first && second);
  const file = join(dir, "amuse.db");
  const db = openDatabase(file);
  const backups = join(dir, "backups");
  const none = await migrate(db, [first], { backups, context: context(dir) });
  assert.equal(none.backup, null);
  assert.equal(existsSync(backups), false);
  db.exec("create table notes (x); insert into notes values ('kept')");
  const later = await migrate(db, [first, second], { backups, context: context(dir), now: () => new Date("2026-10-23T10:15:00.123Z") });
  assert.equal(later.backup, join(backups, "2026-10-23T10-15-00-123Z-pre-migrate.db"));
  assert.equal(statSync(backups).mode & 0o777, 0o700);
  assert.equal(statSync(later.backup ?? "").mode & 0o777, 0o600);
  // a whole database as it was before the second migration
  const copy = new DatabaseSync(later.backup ?? "", { readOnly: true });
  assert.deepEqual(tables(copy), ["a", "notes", "schema_migrations"]);
  assert.deepEqual(applied(copy), ["20260101000000"]);
  assert.equal(query(copy, z.object({ x: z.string() }), "select x from notes")[0]?.x, "kept");
});

test("a copy can be taken while the database is open and in use", async () => {
  const dir = folder();
  const db = openDatabase(join(dir, "amuse.db"));
  db.exec("create table t (x)");
  const writing = (async () => {
    for (let i = 0; i < 200; i++) db.prepare("insert into t values (?)").run(String(i));
  })();
  const target = await snapshot(db, join(dir, "b"), "test");
  await writing;
  const copy = new DatabaseSync(target, { readOnly: true });
  const rows = query(copy, z.object({ n: z.number() }), "select count(*) as n from t")[0]?.n ?? -1;
  assert.ok(rows >= 0 && rows <= 200, "a whole copy of some moment, while it was written to");
});

test("the newest migration can be undone, if it has a way back", async () => {
  const dir = migrationsIn({
    "20260101000000_a.sql": sql("create table a (x);", "drop table a;"),
    "20260101000100_b.sql": sql("create table b (x);"),
  });
  const known = await loadMigrations(dir);
  const db = openDatabase(MEMORY);
  await migrate(db, known, { backups: join(dir, "backups"), context: context(dir) });
  assert.throws(() => revert(db, known, context(dir)), /has no way back/);
  assert.deepEqual(applied(db), ["20260101000000", "20260101000100"]);
  assert.deepEqual(applied(db).length, 2);
  const only = known.slice(0, 1);
  db.exec("drop table b; delete from schema_migrations where version = '20260101000100'");
  const undone = revert(db, only, context(dir));
  assert.ok(undone);
  assert.equal(undone.version, "20260101000000");
  assert.deepEqual(tables(db), ["schema_migrations"]);
  assert.equal(revert(db, only, context(dir)), false);
});

test("a transaction inside another is a savepoint, and a failure undoes only its own part", () => {
  const db = openDatabase(MEMORY);
  db.exec("create table t (x)");
  transaction(db, () => {
    db.exec("insert into t values (1)");
    assert.throws(() => transaction(db, () => { db.exec("insert into t values (2)"); throw new Error("no"); }), /no/);
    db.exec("insert into t values (3)");
  });
  assert.deepEqual(query(db, z.object({ x: z.number() }), "select x from t order by x").map((r) => r.x), [1, 3]);
  assert.equal(db.isTransaction, false);
});

