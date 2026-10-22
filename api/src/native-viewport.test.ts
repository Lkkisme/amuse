import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeViewport, sameViewport } from "./native-viewport.ts";

test("native mobile pages keep CSS pixels rather than VNC's 720px desktop minimum", () => {
  assert.deepEqual(nativeViewport({ width: 412, height: 650 }), { width: 412, height: 650 });
  assert.deepEqual(nativeViewport({ width: 412, height: 300 }), { width: 412, height: 300 });
  assert.deepEqual(nativeViewport({ width: 760, height: 412 }), { width: 760, height: 412 });
  assert.deepEqual(nativeViewport({ width: 3000, height: 1500 }), { width: 1920, height: 960 });
});

test("compositor frames from the previous viewport cannot be relabelled after resize", () => {
  assert.equal(sameViewport({ width: 1024, height: 768 }, { width: 412, height: 650 }), false);
  assert.equal(sameViewport({ width: 412, height: 650 }, { width: 412, height: 300 }), false);
  assert.equal(sameViewport({ width: 412, height: 300 }, { width: 412, height: 300 }), true);
});
