import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFile, replaceFile } from "./durable.ts";

const folder = () => mkdtempSync(join(tmpdir(), "amuse-durable-"));

test("a file is replaced whole, owner-only, with nothing left beside it", () => {
  const dir = folder();
  const path = join(dir, "data.json");
  replaceFile(path, "one");
  replaceFile(path, "two");
  assert.equal(readFileSync(path, "utf8"), "two");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ["data.json"]);
});

test("a file is made only where there is none, whole, and never over another", () => {
  const dir = folder();
  const path = join(dir, "key");
  assert.equal(createFile(path, Buffer.from("first")), true);
  assert.equal(createFile(path, Buffer.from("second")), false);
  assert.equal(readFileSync(path, "utf8"), "first");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ["key"], "no temporary file is left");
  // a larger body is written whole too
  const big = Buffer.alloc(3_000_000, 5);
  assert.equal(createFile(join(dir, "big"), big), true);
  assert.equal(statSync(join(dir, "big")).size, big.length);
  // what a crash leaves is a temporary file, never a short file under the real name
  writeFileSync(join(dir, "other.tmp"), "half");
  replaceFile(join(dir, "other"), "whole");
  assert.equal(readFileSync(join(dir, "other"), "utf8"), "whole");
});
