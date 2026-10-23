import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sqliteAccess } from "./access.ts";
import { locate, openData } from "./data.ts";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const fixture = fileURLToPath(new URL("../../db/fixtures/0.1.0/data", import.meta.url));
const run = (...args: string[]) => execFileSync("node", [cli, ...args], { encoding: "utf8" });
const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-cli-"));
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

test("without a data folder it says so, and an unknown command is usage", () => {
  const noData = spawnSync("node", [cli, "migrate"], { encoding: "utf8", env: { ...process.env, AMUSE_DATA: "", AMUSE_JOURNAL: "" } });
  assert.equal(noData.status, 2);
  assert.match(noData.stderr, /Say which data/);
  const bad = spawnSync("node", [cli, "--data", copy(), "frobnicate"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage:/);
});
