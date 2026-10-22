import assert from "node:assert/strict";
import { test } from "node:test";
import { changedViewport, contained, frameFits, frameOf } from "./native-frames.ts";

test("frame descriptors carry the source viewport and generation, and reject malformed metadata", () => {
  assert.deepEqual(frameOf({ type: "frame", width: 412, height: 650, generation: 3 }), { width: 412, height: 650, generation: 3 });
  for (const value of [null, {}, { type: "frame", width: 0, height: 650, generation: 3 }, { type: "frame", width: 412, height: Infinity, generation: 3 }]) assert.equal(frameOf(value), null);
});

test("keyboard, takeover controls and rotation all request a new viewport", () => {
  const portrait = { width: 412, height: 650 };
  assert.equal(changedViewport(portrait, null), true);
  assert.equal(changedViewport(portrait, portrait), false);
  assert.equal(changedViewport({ width: 412, height: 300 }, portrait), true);
  assert.equal(changedViewport({ width: 650, height: 412 }, portrait), true);
});

test("real CDP downscaled and transitional JPEGs retain shape while stale desktop frames are refused", () => {
  assert.equal(frameFits({ width: 461, height: 768 }, { width: 720, height: 1200 }), true);
  assert.equal(frameFits({ width: 1280, height: 606 }, { width: 1900, height: 900 }), true);
  assert.equal(frameFits({ width: 1024, height: 768 }, { width: 412, height: 650 }), false);
  assert.equal(frameFits({ width: 412, height: 650 }, { width: 412, height: 300 }), false);
  const image = { width: 1024, height: 768 };
  const area = contained(image, { width: 412, height: 650 });
  assert.equal(area.width / image.width, area.height / image.height, "one scale keeps circles round even for an obsolete JPEG");
  assert.equal(area.width, 412);
  assert.equal(area.y > 0, true);
});
