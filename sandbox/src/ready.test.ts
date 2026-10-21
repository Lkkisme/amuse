import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isReady, markReady, netns, unmark, untilReady, watchReady } from "./ready.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "amuse-ready-")), "mark");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("the mark is for one network: another's, an empty file or none is no mark", () => {
  const mark = file();
  assert.equal(isReady(mark, "net:[1]"), false, "none");
  markReady(mark, "net:[1]");
  assert.equal(isReady(mark, "net:[1]"), true);
  assert.equal(isReady(mark, "net:[2]"), false, "left from an earlier network");
  writeFileSync(mark, "");
  assert.equal(isReady(mark, "net:[1]"), false);
  assert.match(netns(), /^net:\[\d+\]$/);
  markReady(mark);
  assert.equal(isReady(mark), true, "this process's own network by default");
});

test("the mark is put whole, and taken away with whatever was left half done", () => {
  const mark = file();
  markReady(mark, "net:[7]");
  assert.deepEqual(readdirSync(join(mark, "..")), ["mark"], "no half-written file left beside it");
  writeFileSync(`${mark}.next`, "half");
  unmark(mark);
  assert.deepEqual(readdirSync(join(mark, "..")), []);
  unmark(mark);
  assert.ok(!existsSync(mark));
});

test("nothing starts until the mark is there, and it is told while waiting", async () => {
  const mark = file();
  let waited = 0;
  let started = false;
  const waiting = untilReady(mark, { every: 5, ns: () => "net:[3]", waiting: () => waited++ }).then(() => (started = true));
  await sleep(40);
  assert.equal(started, false);
  assert.ok(waited > 0);
  markReady(mark, "net:[4]");
  await sleep(30);
  assert.equal(started, false, "a mark for another network does not count");
  markReady(mark, "net:[3]");
  await waiting;
  assert.equal(started, true);
});

test("the daemon is told as soon as the mark goes, or is for another network", async () => {
  const mark = file();
  markReady(mark, "net:[5]");
  let lost = 0;
  const stop = watchReady(mark, () => lost++, { every: 5, ns: () => "net:[5]" });
  await sleep(40);
  assert.equal(lost, 0);
  unmark(mark);
  await sleep(30);
  assert.equal(lost, 1);
  stop();
  markReady(mark, "net:[6]");
  let other = 0;
  watchReady(mark, () => other++, { every: 5, ns: () => "net:[5]" });
  await sleep(30);
  assert.equal(other, 1, "marked for a network that is not its own");
});
