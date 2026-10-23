import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE_INTENT, INTENT, type Input, type Output, type Panel, type Scrolls, type State, initial, opens, step } from "./swipe.ts";

const W = 400;
const free: Scrolls = { left: false, right: false };
const down = (x: number, y = 300, open: Panel | null = null, scrolls: Scrolls = free, time = 0): Input => ({
  kind: "down",
  at: { x, y },
  time,
  width: W,
  open,
  inset: 16,
  scrolls,
});
const move = (x: number, y: number, time: number): Input => ({ kind: "move", at: { x, y }, time });
const up = (time: number): Input => ({ kind: "up", time });

const run = (inputs: Input[]) =>
  inputs.reduce<{ state: State; out: Output[] }>(
    ({ state, out }, input) => {
      const [next, more] = step(state, input);
      return { state: next, out: [...out, ...more] };
    },
    { state: initial, out: [] },
  );
const kinds = (out: Output[]) => out.map((o) => o.kind);
const settled = (out: Output[]) => out.find((o) => o.kind === "settle");

test("a slow drag to the right opens the sidebar once it is clearly horizontal, and the page follows the finger", () => {
  const { out } = run([down(100), move(104, 301, 16), move(120, 302, 32), move(180, 302, 48)]);
  assert.deepEqual(kinds(out), ["begin", "drag"]); // the 4px first move is under INTENT
  assert.deepEqual(out[0], { kind: "begin", panel: "sidebar", progress: 20 / W });
  assert.deepEqual(out[1], { kind: "drag", panel: "sidebar", progress: 80 / W });
});

test("a swipe to the left opens the Amuse panel, which comes from the right", () => {
  const { out } = run([down(300), move(280, 301, 16), move(200, 301, 32)]);
  assert.deepEqual(out[0], { kind: "begin", panel: "muse", progress: 20 / W });
  assert.deepEqual(out[1], { kind: "drag", panel: "muse", progress: 100 / W });
});

test("a vertical scroll is never claimed, and turning sideways later does not claim it", () => {
  const { out, state } = run([down(100), move(102, 330, 16), move(200, 335, 32), move(300, 340, 48), up(64)]);
  assert.deepEqual(out, []);
  assert.equal(state.phase.kind, "idle");
});

test("a diagonal movement is left alone: it has to be clearly more across than down", () => {
  assert.deepEqual(run([down(100), move(115, 320, 16)]).out, []); // 15 across, 20 down
  assert.deepEqual(run([down(100), move(118, 312, 16)]).out, []); // 18 across, 12 down: not 1.5 times
  assert.deepEqual(kinds(run([down(100), move(118, 308, 16)]).out), ["begin"]); // 18 across, 8 down
});

test("under INTENT of travel nothing happens yet", () => {
  assert.deepEqual(run([down(100), move(100 + INTENT - 1, 300, 16)]).out, []);
  assert.deepEqual(kinds(run([down(100), move(100 + INTENT, 300, 16)]).out), ["begin"]);
});

test("a swipe that starts at the edge the page comes from is readier: less travel, and it may be more diagonal", () => {
  assert.deepEqual(kinds(run([down(30), move(30 + EDGE_INTENT, 300, 16)]).out), ["begin"]);
  assert.deepEqual(run([down(100), move(100 + EDGE_INTENT, 300, 16)]).out, []); // not at the edge
  assert.deepEqual(kinds(run([down(30), move(46, 312, 16)]).out), ["begin"]); // 16 across, 12 down
  assert.deepEqual(run([down(100), move(116, 312, 16)]).out, []);
  // the other edge is the Amuse panel's
  assert.deepEqual(kinds(run([down(W - 30), move(W - 30 - EDGE_INTENT, 300, 16)]).out), ["begin"]);
  // and the edge a page does not come from is no help
  assert.deepEqual(run([down(30), move(30 - EDGE_INTENT, 300, 16)]).out, []); // leftward from the left edge: not the sidebar's
});

test("a touch in the system's edge zone is left to the system", () => {
  assert.deepEqual(run([down(10), move(60, 300, 16), move(120, 300, 32)]).out, []);
  assert.deepEqual(run([down(W - 10), move(W - 60, 300, 16)]).out, []);
  assert.deepEqual(kinds(run([down(16), move(60, 300, 16)]).out), ["begin"]);
});

test("sideways content that can still scroll that way keeps the swipe; the other way it does not", () => {
  const code: Scrolls = { left: false, right: true }; // scrolled in: can go back to the start, not further
  assert.deepEqual(run([down(100, 300, null, code), move(130, 300, 16)]).out, []); // finger right: it scrolls
  assert.deepEqual(kinds(run([down(100, 300, null, code), move(70, 300, 16)]).out), ["begin"]); // finger left: it cannot
  const start: Scrolls = { left: true, right: false };
  assert.deepEqual(run([down(100, 300, null, start), move(70, 300, 16)]).out, []);
  assert.deepEqual(kinds(run([down(100, 300, null, start), move(130, 300, 16)]).out), ["begin"]);
});

test("the open sidebar closes by swiping left, and does nothing for a swipe to the right", () => {
  const closing = run([down(300, 300, "sidebar"), move(280, 300, 16), move(100, 300, 32)]);
  assert.deepEqual(closing.out[0], { kind: "begin", panel: "sidebar", progress: 1 - 20 / W });
  assert.deepEqual(closing.out[1], { kind: "drag", panel: "sidebar", progress: 1 - 200 / W });
  assert.deepEqual(run([down(100, 300, "sidebar"), move(150, 300, 16)]).out, []);
});

test("the open Amuse panel closes by swiping right, and does nothing for a swipe to the left", () => {
  const closing = run([down(100, 300, "muse"), move(120, 300, 16), move(300, 300, 32)]);
  assert.deepEqual(closing.out[0], { kind: "begin", panel: "muse", progress: 1 - 20 / W });
  assert.deepEqual(closing.out[1], { kind: "drag", panel: "muse", progress: 1 - 200 / W });
  assert.deepEqual(run([down(300, 300, "muse"), move(250, 300, 16)]).out, []);
});

test("the page stays between closed and open, however far the finger goes", () => {
  const { out } = run([down(100), move(130, 300, 16), move(900, 300, 32), move(-500, 300, 48)]);
  assert.deepEqual(out.map((o) => o.kind === "drag" && o.progress), [false, 1, 0]);
});

test("lifting settles by distance when the finger was slow", () => {
  // 100px of 400, held, then lifted: closed; 220px: open
  assert.deepEqual(settled(run([down(100), move(130, 300, 16), move(200, 300, 400), up(900)]).out), { kind: "settle", panel: "sidebar", open: false });
  assert.deepEqual(settled(run([down(100), move(130, 300, 16), move(320, 300, 400), up(900)]).out), { kind: "settle", panel: "sidebar", open: true });
});

test("lifting settles by direction when the finger was fast, whatever the distance", () => {
  // 40px in 40ms: 1px/ms to the right: opens from a tenth of the way
  assert.deepEqual(settled(run([down(100), move(115, 300, 20), move(140, 300, 40), up(45)]).out), { kind: "settle", panel: "sidebar", open: true });
  // a flick back from far across: closed
  assert.deepEqual(settled(run([down(100), move(130, 300, 16), move(330, 300, 200), move(300, 300, 230), move(260, 300, 250), up(255)]).out), {
    kind: "settle",
    panel: "sidebar",
    open: false,
  });
});

test("the finger's speed is read only over its last moments: a pause before lifting counts as slow", () => {
  const { out } = run([down(100), move(130, 300, 16), move(180, 300, 32), up(500)]);
  assert.deepEqual(settled(out), { kind: "settle", panel: "sidebar", open: false }); // fast at first, then still: by distance
});

test("the Amuse panel settles by the finger going left, and closing it by the finger going right", () => {
  assert.deepEqual(settled(run([down(300), move(285, 300, 20), move(255, 300, 40), up(45)]).out), { kind: "settle", panel: "muse", open: true });
  assert.deepEqual(settled(run([down(100, 300, "muse"), move(115, 300, 20), move(135, 300, 40), up(45)]).out), { kind: "settle", panel: "muse", open: false });
  // slow, over half the way: it closes
  assert.deepEqual(settled(run([down(100, 300, "muse"), move(130, 300, 16), move(320, 300, 800), up(1500)]).out), { kind: "settle", panel: "muse", open: false });
});

test("closing the sidebar slowly needs more than half the way", () => {
  assert.deepEqual(settled(run([down(300, 300, "sidebar"), move(280, 300, 16), move(180, 300, 600), up(1200)]).out), { kind: "settle", panel: "sidebar", open: true });
  assert.deepEqual(settled(run([down(300, 300, "sidebar"), move(280, 300, 16), move(80, 300, 600), up(1200)]).out), { kind: "settle", panel: "sidebar", open: false });
});

test("opening from the edge needs less of the way, other swipes half of it", () => {
  assert.equal(opens(0.35, 0, true), true);
  assert.equal(opens(0.35, 0, false), false);
  assert.equal(opens(0.5, 0, false), true);
  assert.equal(opens(0.2, 0, true), false);
  // fast: the direction decides, at the edge or not
  assert.equal(opens(0.05, 0.6, false), true);
  assert.equal(opens(0.9, -0.6, true), false);
  // a speed under the fling counts for nothing
  assert.equal(opens(0.4, -0.4, true), true);
});

test("an edge swipe that is slow but past its share opens", () => {
  assert.deepEqual(settled(run([down(30), move(40, 300, 16), move(160, 300, 600), up(1200)]).out), { kind: "settle", panel: "sidebar", open: true });
  assert.deepEqual(settled(run([down(100), move(110, 300, 16), move(230, 300, 600), up(1200)]).out), { kind: "settle", panel: "sidebar", open: false });
});

test("the system taking the touch puts the page back where it was", () => {
  assert.deepEqual(settled(run([down(100), move(130, 300, 16), move(300, 300, 32), { kind: "cancel" }]).out), { kind: "settle", panel: "sidebar", open: false });
  assert.deepEqual(settled(run([down(300, 300, "sidebar"), move(280, 300, 16), move(150, 300, 32), { kind: "cancel" }]).out), { kind: "settle", panel: "sidebar", open: true });
});

test("a touch that was never claimed settles nothing, and the next one starts fresh", () => {
  const first = run([down(100), move(102, 330, 16), up(32)]);
  assert.deepEqual(first.out, []);
  const second = run([down(100), move(130, 300, 16)]);
  assert.deepEqual(kinds(second.out), ["begin"]);
  // a tap
  assert.deepEqual(run([down(100), up(50)]).out, []);
});
