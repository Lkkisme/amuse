import assert from "node:assert/strict";
import { test } from "node:test";
import { changedViewport, contained, frameFits, frameOf, nativeFrameHasResolution } from "./native-frames.ts";

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

test("tagged mobile frames refuse the real same-shape CDP keyboard transition", () => {
  const viewport = { width: 411, height: 634 };
  const transition = { width: 166, height: 256 };
  assert.equal(frameFits(transition, viewport), true, "shape alone cannot detect this real low-resolution frame");
  assert.equal(nativeFrameHasResolution(transition, viewport), false);
  assert.equal(nativeFrameHasResolution(viewport, viewport), true);
  assert.equal(nativeFrameHasResolution({ width: 410, height: 633 }, viewport), true, "one pixel of encoding rounding is harmless");
  assert.equal(nativeFrameHasResolution({ width: 409, height: 632 }, viewport), false);
});

test("tagged desktop streams still accept the real CDP caps and continue updating", () => {
  assert.equal(nativeFrameHasResolution({ width: 1280, height: 606 }, { width: 1900, height: 900 }), true);
  assert.equal(nativeFrameHasResolution({ width: 1279, height: 605 }, { width: 1900, height: 900 }), true);
  assert.equal(nativeFrameHasResolution({ width: 640, height: 303 }, { width: 1900, height: 900 }), false);
  assert.equal(nativeFrameHasResolution({ width: 768, height: 1920 }, { width: 800, height: 2000 }), true);
});
