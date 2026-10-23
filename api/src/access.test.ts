import assert from "node:assert/strict";
import { test } from "node:test";
import { migratedDatabase, query } from "@amuse/db";
import { z } from "zod";
import { ASK_MS, resetDevices, sqliteAccess } from "./access.ts";

const phone = { agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", address: "100.64.0.7" };
const laptop = { agent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36", address: "100.64.0.8" };
const clock = () => {
  let at = Date.parse("2026-11-01T09:00:00Z");
  return { now: () => at, pass: (ms: number) => void (at += ms) };
};

test("the device that sets the password is trusted; another one with the right password only waits, until a trusted one approves it", async () => {
  const db = await migratedDatabase();
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, laptop);
  assert.ok(first.kind === "in" && first.device, "a session, and the device's own cookie");
  assert.equal(access.valid(first.session), true);

  assert.equal(await access.login("wrong horse", null, phone), null);
  const asked = await access.login("correct horse", null, phone);
  assert.ok(asked?.kind === "waiting" && asked.device);
  assert.equal(access.waiting(asked.device), true);
  assert.equal(access.admitted(asked.device, phone), null, "not before it is approved");
  const waiting = access.devices().find((d) => d.waiting);
  assert.deepEqual(waiting && { agent: waiting.agent, address: waiting.address, trusted: waiting.trusted }, { ...phone, trusted: false });

  assert.equal(access.approve(waiting?.id ?? ""), true);
  const admitted = access.admitted(asked.device, phone);
  assert.ok(admitted?.kind === "in" && access.valid(admitted.session));
  assert.equal(access.admitted(asked.device, phone), null, "once");
  // from now on the password is enough on it
  const again = await access.login("correct horse", asked.device, phone);
  assert.equal(again?.kind, "in");
});

test("a device turned away, or one that asked too long ago, is not let in; the waiting list is kept short", async () => {
  const db = await migratedDatabase();
  const time = clock();
  const access = sqliteAccess(db, { now: time.now });
  await access.setup("correct horse", null, laptop);
  const denied = await access.login("correct horse", null, phone);
  const deniedId = access.devices().find((d) => d.waiting)?.id ?? "";
  access.deny(deniedId);
  assert.equal(access.approve(deniedId), false);
  assert.equal(access.waiting(denied?.device ?? null), false);

  const late = await access.login("correct horse", null, phone);
  time.pass(ASK_MS);
  assert.equal(access.waiting(late?.device ?? null), false);
  assert.deepEqual(access.devices().filter((d) => d.waiting), [], "an old ask is not shown");
  assert.equal(access.approve(query(db, z.object({ id: z.string() }), "select id from devices where trusted = 0")[0]?.id ?? ""), false);

  for (let i = 0; i < 30; i++) await access.login("correct horse", null, { agent: `bot ${i}`, address: "203.0.113.9" });
  assert.equal(query(db, z.object({ n: z.number() }), "select count(*) as n from devices where trusted = 0")[0]?.n, 20);
});

test("revoking a device ends its sessions; locking one does not untrust it; with none trusted the next password trusts its device", async () => {
  const db = await migratedDatabase();
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, laptop);
  assert.ok(first.kind === "in" && first.device);
  access.logout(first.session);
  const back = await access.login("correct horse", first.device, laptop);
  assert.ok(back?.kind === "in", "a locked trusted device signs in again with the password alone");
  const mine = access.devices()[0]?.id ?? "";
  access.revoke(mine);
  assert.equal(access.valid(back.session), false);
  // no device is trusted any more: the next right password trusts its own, as the first visit did
  const next = await access.login("correct horse", null, phone);
  assert.equal(next?.kind, "in");
  resetDevices(db);
  assert.deepEqual(access.devices(), []);
  assert.equal(next?.kind === "in" && access.valid(next.session), false);
});

test("a session from before devices were known gets its device's cookie once, and changing the password keeps the devices", async () => {
  const db = await migratedDatabase();
  const access = sqliteAccess(db);
  const first = await access.setup("correct horse", null, laptop);
  assert.ok(first.kind === "in");
  assert.deepEqual(access.deviceOf(first.session)?.cookie, null, "it has one already");
  // as the migration leaves a session that was open before
  db.exec("update devices set digest = null");
  const claimed = access.deviceOf(first.session);
  assert.ok(claimed?.cookie);
  assert.equal(access.deviceOf(first.session)?.cookie, null, "made once");
  assert.equal((await access.login("correct horse", claimed.cookie, laptop))?.kind, "in", "the cookie is the trusted device's");

  const other = await access.login("correct horse", claimed.cookie, laptop);
  assert.ok(other?.kind === "in");
  assert.equal(await access.change(first.session, "wrong horse", "battery staple"), null);
  const changed = await access.change(first.session, "correct horse", "battery staple");
  assert.ok(changed && access.valid(changed));
  assert.equal(access.valid(other.session), false, "every other session ends");
  assert.equal(access.devices().length, 1, "the device stays trusted");
  assert.equal(await access.matches("battery staple"), true);
});
