import assert from "node:assert/strict";
import { test } from "node:test";
import { SLOP, claim, closes } from "./sheetDrag.ts";

test("a finger pulls the sheet only once it has clearly gone down", () => {
  assert.equal(claim(0, SLOP - 1), "wait");
  assert.equal(claim(2, 20), "pull");
  assert.equal(claim(0, -20), "other");
  assert.equal(claim(30, 20), "other");
});

test("a sheet let go of closes when pulled far or flicked, and comes back otherwise", () => {
  assert.equal(closes(200, 0.1, 600), true);
  assert.equal(closes(100, 0.1, 600), false);
  assert.equal(closes(40, 0.8, 600), true);
  assert.equal(closes(4, 0.8, 600), false);
  assert.equal(closes(100, -0.8, 600), false);
});
