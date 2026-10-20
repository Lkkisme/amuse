import assert from "node:assert/strict";
import { test } from "node:test";
import { type Input, type Mode, type Output, type State, initial, step } from "./touch-gestures.ts";

const bounds = { left: 0, top: 100, right: 400, bottom: 350 };
const run = (mode: Mode, inputs: Input[]) =>
  inputs.reduce<{ state: State; out: Output[] }>(
    ({ state, out }, input) => {
      const [next, more] = step(state, input, mode, bounds);
      return { state: next, out: [...out, ...more] };
    },
    { state: initial, out: [] },
  );
const actions = (out: Output[]) => out.filter((o) => o.kind !== "hint").map((o) => o.kind);
const at = (x: number, y: number) => ({ x, y });

test("a tap clicks where the finger is", () => {
  const { out, state } = run("touch", [{ kind: "down", id: 1, at: at(50, 200) }, { kind: "up", id: 1 }]);
  assert.deepEqual(actions(out), ["point", "press", "release"]);
  assert.deepEqual(out.find((o) => o.kind === "press"), { kind: "press", at: at(50, 200) });
  assert.equal(state.phase.kind, "idle");
});

test("one finger sliding scrolls the page, and never presses", () => {
  const { out } = run("touch", [
    { kind: "down", id: 1, at: at(50, 300) },
    { kind: "move", id: 1, at: at(50, 280) },
    { kind: "move", id: 1, at: at(50, 250) },
    { kind: "up", id: 1 },
  ]);
  assert.deepEqual(actions(out), ["scroll", "scroll"]);
  assert.deepEqual(out.filter((o) => o.kind === "scroll").map((o) => o.kind === "scroll" && o.by.y), [-20, -30]);
});

test("holding still arms a drag: the button goes down, moves drag, lifting releases", () => {
  const { out } = run("touch", [
    { kind: "down", id: 1, at: at(50, 200) },
    { kind: "move", id: 1, at: at(53, 201) }, // within the slop: still holding
    { kind: "held" },
    { kind: "move", id: 1, at: at(120, 200) },
    { kind: "up", id: 1 },
  ]);
  assert.deepEqual(actions(out), ["point", "press", "point", "release"]);
  assert.deepEqual(out.find((o) => o.kind === "point" && o.down), { kind: "point", at: at(120, 200), down: true });
  const hints = out.flatMap((o) => (o.kind === "hint" ? [o.hint.kind] : []));
  assert.deepEqual(hints, ["holding", "armed", "armed", "none"]);
});

test("the hold timer after a slide has begun does nothing", () => {
  const { out } = run("touch", [
    { kind: "down", id: 1, at: at(50, 300) },
    { kind: "move", id: 1, at: at(50, 250) },
    { kind: "held" },
    { kind: "up", id: 1 },
  ]);
  assert.deepEqual(actions(out), ["scroll"]);
});

test("two fingers scroll by their shared travel", () => {
  const { out } = run("touch", [
    { kind: "down", id: 1, at: at(100, 300) },
    { kind: "down", id: 2, at: at(200, 300) },
    { kind: "move", id: 1, at: at(100, 260) },
    { kind: "move", id: 2, at: at(200, 260) },
    { kind: "up", id: 1 },
    { kind: "up", id: 2 },
  ]);
  const travel = out.flatMap((o) => (o.kind === "scroll" ? [o.by.y] : [])).reduce((a, b) => a + b, 0);
  assert.equal(travel, -40);
  assert.ok(!actions(out).includes("press"));
});

test("trackpad: a slide moves the cursor (faster, kept on the desktop); a tap clicks at the cursor", () => {
  const { out, state } = run("trackpad", [
    { kind: "down", id: 1, at: at(300, 300) },
    { kind: "move", id: 1, at: at(320, 300) },
    { kind: "up", id: 1 },
    { kind: "down", id: 1, at: at(10, 340) },
    { kind: "up", id: 1 },
  ]);
  assert.deepEqual(state.cursor, at(230, 225)); // from the middle (200, 225), 20px × 1.5
  assert.deepEqual(out.find((o) => o.kind === "press"), { kind: "press", at: at(230, 225) });
  const far = run("trackpad", [{ kind: "down", id: 1, at: at(0, 200) }, { kind: "move", id: 1, at: at(900, 200) }]);
  assert.equal(far.state.cursor?.x, 399);
});

test("actual size: one finger moves the view", () => {
  const { out } = run("pan", [{ kind: "down", id: 1, at: at(100, 200) }, { kind: "move", id: 1, at: at(60, 180) }]);
  assert.deepEqual(out.filter((o) => o.kind === "pan"), [{ kind: "pan", by: at(-40, -20) }]);
});
