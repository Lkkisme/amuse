import assert from "node:assert/strict";
import { test } from "node:test";
import { vncGate } from "./vnc.ts";

const handshake = new Uint8Array([...new TextEncoder().encode("RFB 003.008\n"), 1, 1]); // version, security None, shared
const pointer = new Uint8Array([5, 1, 0, 10, 0, 20]);
const key = new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0x61]);
const update = new Uint8Array([3, 1, 0, 0, 0, 0, 5, 0, 3, 32]);
const resize = new Uint8Array([251, 0, 2, 0, 1, 224, 1, 0, ...new Array(16).fill(0)]);
const cat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]));

test("while the agent holds the run, the viewer can watch but not touch", () => {
  const gate = vncGate();
  assert.deepEqual(gate.pass(cat(handshake, update, pointer, key), false), cat(handshake, update));
});

test("while the user holds it, input goes through; desktop resizes never do", () => {
  const gate = vncGate();
  assert.deepEqual(gate.pass(cat(handshake, pointer, resize, key), true), cat(handshake, pointer, key));
});

test("messages split across chunks are reassembled before deciding", () => {
  const gate = vncGate();
  const all = cat(handshake, update, key);
  const out: number[] = [];
  for (const b of all) {
    const passed = gate.pass(new Uint8Array([b]), true);
    assert.notEqual(passed, "close");
    if (passed !== "close") out.push(...passed);
  }
  assert.deepEqual(new Uint8Array(out), all);
});

test("an unknown message closes the stream instead of being forwarded", () => {
  const gate = vncGate();
  assert.equal(gate.pass(cat(handshake, new Uint8Array([77, 0, 0])), true), "close");
});
