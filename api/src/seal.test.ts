import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { KeyUnavailable, Unsealable, fileKey, sealer } from "./seal.ts";

const key = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

test("a sealed value opens to what it was, and is not readable as it is", () => {
  const seal = sealer(key());
  const sealed = seal.seal(bytes("sk-fake-1234567890"), "e-1", "token");
  assert.doesNotMatch(sealed, /sk-fake/);
  assert.doesNotMatch(Buffer.from(sealed, "base64").toString("latin1"), /sk-fake/);
  assert.equal(text(seal.open(sealed, "e-1", "token")), "sk-fake-1234567890");
  // bytes that are not text come back the same
  const binary = Uint8Array.from([0, 255, 1, 254]);
  assert.deepEqual(seal.open(seal.seal(binary, "e-1", "store"), "e-1", "store"), binary);
});

test("each seal has a nonce of its own, and the version comes first", () => {
  const seal = sealer(key());
  const a = Buffer.from(seal.seal(bytes("same"), "e-1", "token"), "base64");
  const b = Buffer.from(seal.seal(bytes("same"), "e-1", "token"), "base64");
  assert.equal(a[0], 1);
  assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13));
  assert.notDeepEqual(a.subarray(29), b.subarray(29));
  // version, 12 bytes of nonce, 16 of tag, then the value's own length
  assert.equal(a.length, 1 + 12 + 16 + 4);
});

test("a sealed value does not open for another entry, another field, another key, another version or damaged", () => {
  const seal = sealer(key());
  const sealed = seal.seal(bytes("secret-value-1"), "e-1", "token");
  assert.throws(() => seal.open(sealed, "e-2", "token"), Unsealable);
  assert.throws(() => seal.open(sealed, "e-1", "other"), Unsealable);
  assert.throws(() => sealer(Uint8Array.from({ length: 32 }, () => 9)).open(sealed, "e-1", "token"), Unsealable);
  const raw = Buffer.from(sealed, "base64");
  const future = Buffer.from(raw);
  future[0] = 2;
  assert.throws(() => seal.open(future.toString("base64"), "e-1", "token"), /format this version does not know/);
  const flipped = Buffer.from(raw);
  flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
  assert.throws(() => seal.open(flipped.toString("base64"), "e-1", "token"), Unsealable);
  assert.throws(() => seal.open(raw.subarray(0, 10).toString("base64"), "e-1", "token"), Unsealable);
  // names are bound whole: ("a","bc") is not ("ab","c")
  const joined = seal.seal(bytes("secret-value-2"), "ab", "c");
  assert.throws(() => seal.open(joined, "a", "bc"), Unsealable);
});

test("the key file is made on first start, owner-only, 32 bytes, and read back as it is", () => {
  const path = join(mkdtempSync(join(tmpdir(), "amuse-key-")), "keys", "store.key");
  const made = fileKey(path, false);
  assert.equal(made.length, 32);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(fileKey(path, true), made);
  assert.deepEqual(readFileSync(path), made);
});

test("a missing key is never made anew over sealed secrets: it refuses, in words", () => {
  const path = join(mkdtempSync(join(tmpdir(), "amuse-key-")), "store.key");
  assert.throws(() => fileKey(path, true), (e: unknown) => e instanceof KeyUnavailable && /missing/.test(e.message) && /Restore/.test(e.message));
  assert.throws(() => readFileSync(path), /ENOENT/, "and no key was made");
});

test("a key file of the wrong size is refused, not replaced", () => {
  const path = join(mkdtempSync(join(tmpdir(), "amuse-key-")), "store.key");
  writeFileSync(path, "short");
  assert.throws(() => fileKey(path, false), KeyUnavailable);
  assert.equal(readFileSync(path, "utf8"), "short");
});

test("a key path that is a folder, or a key file that cannot be read, is a damaged key, said in words: not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-key-"));
  const asFolder = join(dir, "store.key");
  mkdirSync(asFolder);
  assert.throws(() => fileKey(asFolder, false), (e: unknown) => e instanceof KeyUnavailable && e.trouble === "damaged" && /could not be read/.test(e.message));
  assert.throws(() => fileKey(asFolder, true), (e: unknown) => e instanceof KeyUnavailable && e.trouble === "damaged");
  if (process.getuid?.() !== 0) {
    const locked = join(dir, "locked.key");
    writeFileSync(locked, Buffer.alloc(32, 3), { mode: 0o000 });
    assert.throws(() => fileKey(locked, true), (e: unknown) => e instanceof KeyUnavailable && e.trouble === "damaged");
  }
});

test("the key is made through a temporary file of its own, never written into one that was lying there", () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-key-"));
  const path = join(dir, "store.key");
  // an older temporary name, left by a crash, is not reused
  writeFileSync(`${path}.${process.pid}.new`, "left over");
  const key = fileKey(path, false);
  assert.equal(key.length, 32);
  assert.deepEqual(readdirSync(dir).sort(), [`store.key`, `store.key.${process.pid}.new`].sort());
});
