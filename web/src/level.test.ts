import assert from "node:assert/strict";
import { test } from "node:test";
import { BARS, QUIET, QUIET_AFTER_MS, clock, level, push, rms, silentAtStart, smooth } from "./level.ts";

test("the RMS of silence is 0, of a constant is that constant, of a full sine about 0.707", () => {
  assert.equal(rms([]), 0);
  assert.equal(rms(new Float32Array(100)), 0);
  assert.equal(rms([0.5, 0.5, -0.5, -0.5]), 0.5);
  const sine = Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
  assert.ok(Math.abs(rms(sine) - Math.SQRT1_2) < 0.001);
});

test("a level is 0 to 1 on a decibel scale: silence and a whisper of noise are empty, speech is part way, a shout is full", () => {
  assert.equal(level(0), 0);
  assert.equal(level(Number.NaN), 0);
  assert.equal(level(0.0005), 0);
  assert.equal(level(1), 1);
  const talking = level(0.05);
  assert.ok(talking > 0.4 && talking < 0.9, String(talking));
  assert.ok(level(0.01) < level(0.05) && level(0.05) < level(0.2));
});

test("smoothing rises faster than it falls, and settles on a steady level", () => {
  const rise = smooth(0, 1);
  const fall = 1 - smooth(1, 0);
  assert.ok(rise > fall);
  let shown = 0;
  for (let i = 0; i < 40; i++) shown = smooth(shown, 0.5);
  assert.ok(Math.abs(shown - 0.5) < 0.001);
});

test("the bars keep the newest ones, up to the capacity, without changing the old list", () => {
  const first = [0.1, 0.2];
  assert.deepEqual(push(first, 0.3), [0.1, 0.2, 0.3]);
  assert.deepEqual(first, [0.1, 0.2]);
  assert.deepEqual(push([1, 2, 3], 4, 3), [2, 3, 4]);
  let bars: number[] = [];
  for (let i = 0; i < BARS * 2; i++) bars = push(bars, i);
  assert.equal(bars.length, BARS);
  assert.equal(bars.at(-1), BARS * 2 - 1);
});

test("the silence hint comes after a few quiet seconds, not before, and never once anything was heard", () => {
  assert.equal(silentAtStart(0, 0), false);
  assert.equal(silentAtStart(0, QUIET_AFTER_MS - 1), false);
  assert.equal(silentAtStart(0, QUIET_AFTER_MS), true);
  assert.equal(silentAtStart(QUIET - 0.01, QUIET_AFTER_MS * 3), true);
  assert.equal(silentAtStart(QUIET, QUIET_AFTER_MS * 3), false);
  assert.equal(silentAtStart(0.7, QUIET_AFTER_MS), false);
});

test("the clock reads minutes and seconds", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(7400), "0:07");
  assert.equal(clock(59_999), "0:59");
  assert.equal(clock(60_000), "1:00");
  assert.equal(clock(12 * 60_000 + 3000), "12:03");
  assert.equal(clock(3_723_000), "1:02:03");
  assert.equal(clock(-5), "0:00");
});
