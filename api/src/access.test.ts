import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileAccess, pairDeviceSession, PasswordRejected } from "./access.ts";

test("owner USB pairing adds a hashed revocable session without changing the password", async () => {
  const { path, access, cleanup } = fresh();
  try {
    const existing = await access.setup("owner password");
    const before = JSON.parse(readFileSync(path, "utf8"));
    const device = pairDeviceSession(path);
    assert.match(device, /^[A-Za-z0-9_-]{43}$/);
    const reloaded = fileAccess(path);
    assert.ok(reloaded.valid(device));
    assert.ok(reloaded.valid(existing));
    const after = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(after.password, before.password);
    assert.equal(after.sessions.length, before.sessions.length + 1);
    assert.equal(readFileSync(path, "utf8").includes(device), false);
    await reloaded.change("owner password", "owner replacement");
    assert.equal(reloaded.valid(device), false, "changing the owner credential revokes paired devices too");
  } finally { cleanup(); }
});

test("USB pairing cannot silently initialize an unconfigured instance", () => {
  const { path, cleanup } = fresh();
  try { assert.throws(() => pairDeviceSession(path)); } finally { cleanup(); }
});

function fresh() {
  const directory = mkdtempSync(join(tmpdir(), "amuse-pin-"));
  const path = join(directory, "access.json");
  return { path, access: fileAccess(path), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const rejected = ["", "0", "01", "012", "01234", "012345", "0123456", "abcd", "12a4", "１２３４", "123\n", "1234\n", "1234\r\n", " 123", "123 "];

test("setup rejects short credentials except an exact four ASCII digit PIN", async () => {
  const { path, access, cleanup } = fresh();
  try {
    for (const password of rejected) {
      await assert.rejects(access.setup(password), PasswordRejected, JSON.stringify(password));
      assert.equal(access.ready(), false, "a rejected setup does not set the credential");
    }
    const session = await access.setup("0123");
    assert.ok(access.valid(session));
    const reopened = fileAccess(path);
    assert.ok(reopened.valid(session), "sessions retain the existing persistent format");
    assert.notEqual(await reopened.login("0123"), null, "a leading zero survives hashing and reopening");
    assert.equal(await reopened.login("123"), null);
    assert.equal(await reopened.login("０１２３"), null);
    await assert.rejects(reopened.setup("4567"), PasswordRejected, "setup cannot replace an existing PIN");
  } finally {
    cleanup();
  }
});

test("invalid replacements leave the credential and all sessions intact", async () => {
  const { path, access, cleanup } = fresh();
  try {
    const session = await access.setup("legacy password");
    const before = readFileSync(path, "utf8");
    for (const next of rejected) {
      await assert.rejects(access.change("legacy password", next), PasswordRejected, JSON.stringify(next));
      assert.equal(readFileSync(path, "utf8"), before, "a rejected change does not rewrite the store");
      assert.ok(access.valid(session));
    }
    assert.notEqual(await access.login("legacy password"), null);
  } finally {
    cleanup();
  }
});

test("an existing scrypt password store can migrate to a PIN and revokes every prior session", async () => {
  const { path, cleanup } = fresh();
  try {
    const salt = Buffer.alloc(16, 1);
    const priorSession = "existing-session";
    writeFileSync(path, JSON.stringify({
      password: {
        salt: salt.toString("hex"),
        hash: scryptSync("old password", salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 ** 2 }).toString("hex"),
      },
      sessions: [createHash("sha256").update(priorSession).digest("hex")],
    }));
    const access = fileAccess(path);
    assert.ok(access.ready());
    assert.ok(access.valid(priorSession), "opening an existing store preserves its sessions");
    const other = await access.login("old password");
    assert.notEqual(other, null, "the preexisting password still opens a session");
    assert.equal(await access.change("wrong password", "0123"), null);
    assert.ok(access.valid(priorSession), "a wrong current credential cannot revoke sessions");
    const next = await access.change("old password", "0123");
    assert.notEqual(next, null);
    assert.ok(access.valid(next!));
    assert.equal(access.valid(priorSession), false);
    assert.equal(access.valid(other!), false);
    assert.equal(await access.login("old password"), null);
    assert.notEqual(await access.login("0123"), null);
    const reopened = fileAccess(path);
    assert.equal(await reopened.login("old password"), null);
    assert.notEqual(await reopened.login("0123"), null);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(Object.keys(stored).sort(), ["password", "sessions"]);
    assert.deepEqual(Object.keys(stored.password).sort(), ["hash", "salt"]);
    assert.match(stored.password.salt, /^[0-9a-f]{32}$/);
    assert.match(stored.password.hash, /^[0-9a-f]{128}$/);
    assert.ok(stored.sessions.every((session: string) => /^[0-9a-f]{64}$/.test(session)));
  } finally {
    cleanup();
  }
});

test("eight character legacy passwords remain accepted for setup and change", async () => {
  const { access, cleanup } = fresh();
  try {
    await access.setup("abcd1234");
    assert.notEqual(await access.login("abcd1234"), null);
    assert.notEqual(await access.change("abcd1234", "abcdefgh"), null);
    assert.equal(await access.login("abcd1234"), null);
    assert.notEqual(await access.login("abcdefgh"), null);
  } finally {
    cleanup();
  }
});
