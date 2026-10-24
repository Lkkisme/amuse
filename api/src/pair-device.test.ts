import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { migratedDatabase, tempFolder } from "@amuse/db";
import { MAX_SESSIONS, sqliteAccess } from "./access.ts";
import { sqlitePin } from "./pin.ts";
import { pairDeviceToFile } from "./pair-device.ts";

const serverOrigin = "https://owner-device.example:8443";
const seen = { agent: "Original owner device", address: "127.0.0.1" };

test("local SQLite pairing creates one revocable device and writes its token only to a new private file", async (t) => {
  const directory = tempFolder("amuse-pair-device-");
  const db = await migratedDatabase();
  t.after(() => db.close());
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, seen);
  assert.ok(first.kind === "in");
  const password = db.prepare("select * from access").all();
  const pinBefore = db.prepare("select * from pin").all();
  const output = join(directory, "new-phone.json");
  const metadata = pairDeviceToFile(db, { output, serverOrigin, name: "Owner's Android" });
  const pairing = JSON.parse(readFileSync(output, "utf8")) as { sessionToken: string; serverOrigin: string; deviceId: string };
  assert.equal(pairing.serverOrigin, serverOrigin);
  assert.equal(pairing.deviceId, metadata.deviceId);
  assert.match(pairing.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal("sessionToken" in metadata, false);
  assert.equal(access.valid(pairing.sessionToken), true);
  assert.equal(access.valid(first.session), true);
  assert.deepEqual(password, db.prepare("select * from access").all());
  assert.deepEqual(pinBefore, db.prepare("select * from pin").all());
  assert.equal(sqlitePin(db).off(), false, "pairing does not change PIN policy");
  assert.equal(access.devices().find((device) => device.id === metadata.deviceId)?.trusted, true);
  assert.equal(access.deviceOf(pairing.sessionToken)?.id, metadata.deviceId);
  assert.equal(JSON.stringify(db.prepare("select * from sessions").all()).includes(pairing.sessionToken), false);
  if (process.platform !== "win32") assert.equal(statSync(output).mode & 0o777, 0o600);
  access.revoke(metadata.deviceId);
  assert.equal(access.valid(pairing.sessionToken), false);
  assert.equal(access.valid(first.session), true, "revoking the new phone does not revoke the old device");
});

test("an existing pairing file, output failure or an unconfigured instance leaves the database unchanged", async (t) => {
  const directory = tempFolder("amuse-pair-refusal-");
  const db = await migratedDatabase();
  t.after(() => db.close());
  const output = join(directory, "existing.json");
  assert.throws(() => pairDeviceToFile(db, { output, serverOrigin }), /Set up/);
  const access = sqliteAccess(db);
  await access.setup("correct horse", null, seen);
  const baseline = JSON.stringify({ devices: db.prepare("select * from devices").all(), sessions: db.prepare("select * from sessions").all() });
  writeFileSync(output, "original paired token must stay");
  assert.throws(() => pairDeviceToFile(db, { output, serverOrigin }), /already exists/);
  assert.equal(readFileSync(output, "utf8"), "original paired token must stay");
  assert.throws(() => pairDeviceToFile(db, { output: join(directory, "missing", "phone.json"), serverOrigin }), /directory/);
  assert.throws(() => pairDeviceToFile(db, { output: join(directory, "another.json"), serverOrigin: "https://user:token@example.com/" }), /origin/);
  assert.equal(JSON.stringify({ devices: db.prepare("select * from devices").all(), sessions: db.prepare("select * from sessions").all() }), baseline);
});

test("pairing shares the server's session cap and the old device is retained until its session reaches that cap", async (t) => {
  const directory = tempFolder("amuse-pair-limit-");
  const db = await migratedDatabase();
  t.after(() => db.close());
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, seen);
  assert.ok(first.kind === "in");
  for (let at = 0; at < MAX_SESSIONS - 1; at++) pairDeviceToFile(db, { output: join(directory, `phone-${at}.json`), serverOrigin });
  assert.equal(access.valid(first.session), true);
  pairDeviceToFile(db, { output: join(directory, "last-phone.json"), serverOrigin });
  assert.equal(access.valid(first.session), false, "the oldest session expires under the same ordinary cap");
  assert.equal(db.prepare("select count(*) as n from sessions").get()?.["n"], MAX_SESSIONS);
});

test("a file created in the publication gap is never overwritten and the new database rows roll back", async (t) => {
  const directory = tempFolder("amuse-pair-publication-");
  const db = await migratedDatabase();
  t.after(() => db.close());
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, seen);
  assert.ok(first.kind === "in");
  const baseline = JSON.stringify({ devices: db.prepare("select * from devices").all(), sessions: db.prepare("select * from sessions").all() });
  const output = join(directory, "concurrent-pair.json");
  db.function("occupy_pair_output", () => { writeFileSync(output, "another owner's existing pairing"); return 1; });
  db.exec("create trigger occupy_pair_output after insert on sessions begin select occupy_pair_output(); end");
  assert.throws(() => pairDeviceToFile(db, { output, serverOrigin }), /already exists/);
  assert.equal(readFileSync(output, "utf8"), "another owner's existing pairing");
  assert.equal(JSON.stringify({ devices: db.prepare("select * from devices").all(), sessions: db.prepare("select * from sessions").all() }), baseline);
  assert.equal(access.valid(first.session), true);
});

test("the local CLI contacts no service, runs no migration and prints no session token", async (t) => {
  const directory = tempFolder("amuse-pair-cli-");
  const db = await migratedDatabase(directory);
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, seen);
  assert.ok(first.kind === "in");
  db.close();
  const output = join(directory, "cli-phone.json");
  const entry = fileURLToPath(new URL("./pair-device.ts", import.meta.url));
  const args = [entry, "--data", directory, "--server", serverOrigin, "--output", output, "--name", "CLI phone"];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, AMUSE_JOURNAL: "ignored-old-path/events.jsonl" } });
  assert.equal(result.status, 0, result.stderr);
  const pairing = JSON.parse(readFileSync(output, "utf8")) as { sessionToken: string };
  assert.equal(result.stdout.includes(pairing.sessionToken), false);
  assert.equal(result.stderr.includes(pairing.sessionToken), false);
  assert.equal(JSON.parse(result.stdout).paired, true);
  const refused = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "");
  assert.equal(refused.stderr.includes(pairing.sessionToken), false);
  const reopened = await migratedDatabase(directory);
  t.after(() => reopened.close());
  assert.equal(sqliteAccess(reopened).valid(first.session), true);
  assert.equal(sqliteAccess(reopened).valid(pairing.sessionToken), true);
});
