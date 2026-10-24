import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { retryViewerClose, viewerRecovery } from "./socket-recovery.ts";

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const nav = { onLine: true };
  for (const [name, value] of Object.entries({ window: win, document: doc, navigator: nav })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : Reflect.deleteProperty(globalThis, name));
  }
  let restarts = 0, pauses = 0;
  const recovery = viewerRecovery(() => restarts++, () => pauses++);
  t.after(() => recovery.close());
  return { recovery, doc, nav, event: (name: string) => win.dispatchEvent(new Event(name)), restarts: () => restarts, pauses: () => pauses };
}

test("transient close policy does not retry detached terminals, auth, capacity or protocol errors", () => {
  for (const code of [1000, 1002, 1008, 4401, 4403, 4404, 4429, 4503]) assert.equal(retryViewerClose(code), false);
  for (const code of [1001, 1005, 1006, 1011, 1012, 1013]) assert.equal(retryViewerClose(code), true);
});

test("viewer retries back off once, sleep in background, and terminal errors require manual retry", (t) => {
  const f = fixture(t);
  f.recovery.fail(); t.mock.timers.tick(500); assert.equal(f.restarts(), 1);
  f.recovery.fail(); t.mock.timers.tick(999); assert.equal(f.restarts(), 1);
  f.event("amuse:pause"); t.mock.timers.tick(60_000); assert.equal(f.restarts(), 1);
  assert.equal(f.pauses(), 1, "pause releases current held inputs");
  f.event("amuse:resume"); t.mock.timers.tick(0); assert.equal(f.restarts(), 2);
  f.recovery.fail(false); f.event("online"); f.event("amuse:resume"); t.mock.timers.tick(60_000);
  assert.equal(f.restarts(), 2);
  f.recovery.manual(); assert.equal(f.restarts(), 3);
});

test("short focus preserves a healthy stream, long suspension replaces only a silent transport", (t) => {
  const f = fixture(t); f.recovery.ready();
  f.event("amuse:resume"); f.event("pageshow"); t.mock.timers.tick(5_000);
  assert.equal(f.restarts(), 0);
  f.event("amuse:pause"); t.mock.timers.tick(30_000);
  f.event("amuse:resume"); f.event("pageshow"); t.mock.timers.tick(0);
  assert.equal(f.restarts(), 1, "duplicate native/browser lifecycle events coalesce");
});

test("network handover gives fresh frames a grace period, then reconnects an unresponsive viewer", (t) => {
  const f = fixture(t); f.recovery.ready();
  f.event("amuse:network-change"); f.event("online");
  t.mock.timers.tick(2_000); f.recovery.message(); t.mock.timers.tick(3_000);
  assert.equal(f.restarts(), 0, "new data proves the stream survived");
  f.event("amuse:network-change"); t.mock.timers.tick(2_000);
  assert.equal(f.restarts(), 1);
  f.recovery.fail(); f.recovery.close(); t.mock.timers.tick(60_000); f.event("online");
  assert.equal(f.restarts(), 1, "disposed/old URL callbacks cannot reconnect a new viewer");
});
