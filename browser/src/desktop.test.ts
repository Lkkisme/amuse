import assert from "node:assert/strict";
import { test } from "node:test";
import { fitted } from "./desktop.ts";

test("a phone's portrait screen: its shape, scaled up to a desktop-sized short side", () => {
  assert.deepEqual(fitted({ width: 390, height: 560 }), { width: 720, height: 1034 });
});

test("a large screen keeps its own size; a huge one is brought down to the long-side limit", () => {
  assert.deepEqual(fitted({ width: 1200, height: 760 }), { width: 1200, height: 760 });
  assert.deepEqual(fitted({ width: 3000, height: 1500 }), { width: 1920, height: 960 });
});

test("sides come out even", () => {
  const { width, height } = fitted({ width: 391, height: 587 });
  assert.equal(width % 2, 0);
  assert.equal(height % 2, 0);
});
