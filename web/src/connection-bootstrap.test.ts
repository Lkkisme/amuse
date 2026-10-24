import assert from "node:assert/strict";
import test from "node:test";
import { waitForUnlock } from "./connection-bootstrap.ts";

function lifecycle() {
  let active = true;
  let listener: ((reason: "resume" | "pause" | "network") => void) | undefined;
  let closed = false;
  return {
    observe(fn: NonNullable<typeof listener>) { listener = fn; return { active: () => active, close() { closed = true; } }; },
    signal(reason: "resume" | "pause" | "network") { if (reason === "pause") active = false; else active = true; listener?.(reason); },
    get closed() { return closed; },
  };
}

test("network failures and temporary HTTP errors do not falsely open the PIN page", async () => {
  const life = lifecycle();
  let calls = 0;
  const response = await waitForUnlock(async () => {
    calls++;
    if (calls === 1) throw new TypeError("network changed");
    return new Response(null, { status: calls === 2 ? 503 : 204 });
  }, life.observe, [0]);
  assert.equal(response.status, 204);
  assert.equal(calls, 3);
  assert.equal(life.closed, true);
});

test("real authentication and policy errors are returned once without retry", async () => {
  for (const status of [401, 403]) {
    const life = lifecycle();
    let calls = 0;
    const response = await waitForUnlock(async () => { calls++; return new Response(null, { status }); }, life.observe, [0]);
    assert.equal(response.status, status);
    assert.equal(calls, 1);
    assert.equal(life.closed, true);
  }
});

test("pause aborts a pending check and waits for foreground before making another", async () => {
  const life = lifecycle();
  let calls = 0;
  let pendingSignal: AbortSignal | undefined;
  const request = waitForUnlock((signal) => {
    calls++;
    pendingSignal = signal;
    return calls === 1 ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("paused")))) : Promise.resolve(new Response(null, { status: 204 }));
  }, life.observe, [0]);
  life.signal("pause");
  assert.equal(pendingSignal?.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
  life.signal("resume");
  assert.equal((await request).status, 204);
  assert.equal(calls, 2);
});

test("radio handover aborts a stale check and starts one replacement", async () => {
  const life = lifecycle();
  let calls = 0;
  const request = waitForUnlock((signal) => {
    calls++;
    return calls === 1 ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("handover")))) : Promise.resolve(new Response(null, { status: 204 }));
  }, life.observe, [30_000]);
  life.signal("network");
  assert.equal((await request).status, 204);
  assert.equal(calls, 2);
});
