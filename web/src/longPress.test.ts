import assert from "node:assert/strict";
import { test } from "node:test";
import { SLOP, drifted } from "./longPress.ts";

test("a finger that has moved more than a few pixels is scrolling or swiping, not holding", () => {
  const from = { x: 100, y: 100 };
  assert.equal(drifted(from, { x: 100, y: 100 }), false);
  assert.equal(drifted(from, { x: 100 + SLOP, y: 100 }), false);
  assert.equal(drifted(from, { x: 100, y: 100 + SLOP + 1 }), true);
  assert.equal(drifted(from, { x: 106, y: 106 }), true);
});
