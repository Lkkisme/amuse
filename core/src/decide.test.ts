import assert from "node:assert/strict";
import { test } from "node:test";
import { type Browser, type BrowserStatus, type Entity, type State, apply, empty } from "@remuse/protocol";
import { type Change, type Context, decide, decideAgent, place, recover } from "./decide.ts";

const at = "2026-10-20T08:00:00Z";
const ctx: Context = { now: at, id: (prefix) => `${prefix}1` };
const record = (state: State, changes: Change[]): State =>
  changes.reduce((s, change) => apply(s, { seq: s.seq + 1, event: place(s, change) }), state);
const stateOf = (...entities: Entity[]): State => record(empty, entities.map((entity) => ({ kind: "upserted", entity })));
const browser = (status: BrowserStatus, live = true): Browser => ({ kind: "browser", id: "b1", at, title: "Log in", url: "https://x.example/", status, instructions: "Log in", result: null, step: null, live });

test("chat.send records the prompt and asks the agent", () => {
  const d = decide(empty, { method: "chat.send", params: { chat: "main", text: "hi", timezone: "Asia/Shanghai", attachments: [] } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.output, { id: "p1" });
  assert.deepEqual(d.changes, [{ kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hi", timezone: "Asia/Shanghai", attachments: [] } }]);
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "hi", attachments: [] }]);
});

test("browser moves follow Muse: take → paused, handBack → working, stop → stopped", () => {
  const moves = [
    ["working", "take", "paused"],
    ["needs_you", "take", "paused"],
    ["completed", "take", "paused"],
    ["paused", "handBack", "working"],
    ["waiting", "stop", "stopped"],
  ] as const;
  for (const [from, action, to] of moves) {
    const d = decide(stateOf(browser(from)), { method: "browser.control", params: { id: "b1", action } }, ctx);
    assert.ok(d.ok, `${action} from ${from}`);
    const moved = browser(to, action !== "stop"); // a stopped run's browser closes at once
    assert.deepEqual(d.changes, [{ kind: "upserted", entity: moved }]);
    assert.deepEqual(d.effects, [{ kind: "browser", browser: moved, action }]);
  }
});

test("illegal browser moves are rejected with where they came from", () => {
  const illegal = [
    ["stopped", "take"],
    ["working", "handBack"],
    ["completed", "stop"],
    ["failed", "take"],
  ] as const;
  for (const [from, action] of illegal) {
    const d = decide(stateOf(browser(from)), { method: "browser.control", params: { id: "b1", action } }, ctx);
    assert.deepEqual(d, { ok: false, rejection: { kind: "invalid", action, from } });
  }
  assert.deepEqual(decide(empty, { method: "browser.control", params: { id: "b9", action: "take" } }, ctx), {
    ok: false,
    rejection: { kind: "notFound", entity: "browser", id: "b9" },
  });
});

test("an approval resolves once; allow_* approves, deny_* denies", () => {
  const pending = stateOf({ kind: "approval", id: "a1", at, action: "Send", target: "t", detail: "d", remember: true, status: "pending", expires: at });
  const allow = decide(pending, { method: "approval.resolve", params: { id: "a1", resolution: "allow_always" } }, ctx);
  assert.ok(allow.ok && allow.changes[0]?.kind === "upserted" && allow.changes[0].entity.kind === "approval");
  assert.equal(allow.changes[0].entity.status, "approved");
  const deny = decide(pending, { method: "approval.resolve", params: { id: "a1", resolution: "deny_always" } }, ctx);
  assert.ok(deny.ok && deny.changes[0]?.kind === "upserted" && deny.changes[0].entity.kind === "approval");
  assert.equal(deny.changes[0].entity.status, "denied");
  const resolved = record(pending, allow.changes);
  assert.deepEqual(decide(resolved, { method: "approval.resolve", params: { id: "a1", resolution: "deny" } }, ctx), {
    ok: false,
    rejection: { kind: "invalid", action: "resolve", from: "approved" },
  });
});

test("chat.stop ends streaming replies and the activity, then interrupts", () => {
  const streaming = stateOf({ kind: "reply", id: "r1", at, text: "Hel", streaming: true, attachments: [] });
  const d = decide(streaming, { method: "chat.stop", params: { chat: "main" } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.changes, [
    { kind: "upserted", entity: { kind: "reply", id: "r1", at, text: "Hel", streaming: false, attachments: [] } },
    { kind: "activity", activity: null },
  ]);
  assert.deepEqual(d.effects, [{ kind: "interrupt" }]);
});

test("only running tasks stop", () => {
  const task = (status: "working" | "completed"): Entity => ({ kind: "task", id: "t1", at, title: "T", steps: [], status });
  assert.ok(decide(stateOf(task("working")), { method: "task.stop", params: { id: "t1" } }, ctx).ok);
  assert.equal(decide(stateOf(task("completed")), { method: "task.stop", params: { id: "t1" } }, ctx).ok, false);
});

test("agent actions: connect reuses a pending request for the same provider; browse starts a run", () => {
  const first = decideAgent(empty, "connect", { kind: "connect", provider: "gmail", title: "Gmail" }, ctx);
  assert.ok(first.ok);
  const state = record(empty, first.changes);
  const again = decideAgent(state, "connect", { kind: "connect", provider: "gmail", title: "Gmail" }, ctx);
  assert.ok(again.ok);
  assert.deepEqual(again.changes, []);
  assert.equal(again.output.id, first.output.id);

  const browse = decideAgent(empty, "browse", { kind: "browse", title: "Tides", url: "https://tides.example/", instructions: "Read today's tides" }, ctx);
  assert.ok(browse.ok);
  const run: Browser = { kind: "browser", id: "b1", at, title: "Tides", url: "https://tides.example/", status: "working", instructions: "Read today's tides", result: null, step: null, live: true };
  assert.deepEqual(browse.changes, [{ kind: "upserted", entity: run }]);
  assert.deepEqual(browse.effects, [{ kind: "browse", browser: run }]);
});

test("recovery ends interrupted replies and clears the activity; a quiet state needs nothing", () => {
  const busy = apply(stateOf({ kind: "reply", id: "r1", at, text: "Hal", streaming: true, attachments: [] }), {
    seq: 2,
    event: { kind: "activity", activity: { kind: "responding", label: null } },
  });
  assert.deepEqual(recover(busy, at), [
    { kind: "upserted", entity: { kind: "reply", id: "r1", at, text: "Hal", streaming: false, attachments: [] } },
    { kind: "activity", activity: null },
  ]);
  assert.deepEqual(recover(stateOf({ kind: "prompt", id: "p1", at, text: "hi", timezone: "UTC", attachments: [] }), at), []);
});

test("only a run the user holds is reshaped to their screen", () => {
  const fit = (status: BrowserStatus) => decide(stateOf(browser(status)), { method: "browser.fit", params: { id: "b1", width: 390, height: 560 } }, ctx);
  const held = fit("paused");
  assert.ok(held.ok);
  assert.deepEqual(held.changes, []);
  assert.deepEqual(held.effects, [{ kind: "fit", id: "b1", viewer: { width: 390, height: 560 } }]);
  assert.deepEqual(fit("working"), { ok: false, rejection: { kind: "invalid", action: "fit", from: "working" } });
});

test("a browser that is gone is only a record: no taking over; stopping closes it at once; release is idempotent", () => {
  const take = (b: Browser) => decide(stateOf(b), { method: "browser.control", params: { id: "b1", action: "take" } }, ctx);
  assert.deepEqual(take(browser("completed", false)), { ok: false, rejection: { kind: "gone", id: "b1" } });
  assert.ok(take(browser("completed")).ok);

  const stop = decide(stateOf(browser("working")), { method: "browser.control", params: { id: "b1", action: "stop" } }, ctx);
  assert.ok(stop.ok);
  assert.deepEqual(stop.changes, [{ kind: "upserted", entity: browser("stopped", false) }]);

  const released = decideAgent(stateOf(browser("completed")), "released", { kind: "released", id: "b1" }, ctx);
  assert.ok(released.ok);
  assert.deepEqual(released.changes, [{ kind: "upserted", entity: browser("completed", false) }]);
  const again = decideAgent(stateOf(browser("completed", false)), "released", { kind: "released", id: "b1" }, ctx);
  assert.ok(again.ok);
  assert.deepEqual(again.changes, []);
});

test("after a restart no browser is live", () => {
  assert.deepEqual(recover(stateOf(browser("completed")), at), [{ kind: "upserted", entity: browser("completed", false) }]);
  assert.deepEqual(recover(stateOf(browser("working")), at), [{ kind: "upserted", entity: browser("stopped", false) }]);
  assert.deepEqual(recover(stateOf(browser("stopped", false)), at), []);
});

test("a run ends with what came of it, from in flight or from the user's hold; not once it has ended", () => {
  const end = (from: BrowserStatus) =>
    decideAgent(stateOf(browser(from)), "browserEnded", { kind: "browserEnded", id: "b1", status: "completed", result: "Found it" }, ctx);
  const ended = end("working");
  assert.ok(ended.ok);
  assert.deepEqual(ended.changes, [{ kind: "upserted", entity: { ...browser("completed"), result: "Found it" } }]);
  assert.ok(end("paused").ok);
  assert.deepEqual(end("stopped"), { ok: false, rejection: { kind: "invalid", action: "browserEnded", from: "stopped" } });
});

test("a run's step is its agent's while it works; ending, stopping or the user taking it clears it", () => {
  const step = (from: BrowserStatus) => decideAgent(stateOf(browser(from)), "browserStep", { kind: "browserStep", id: "b1", step: "Opening page" }, ctx);
  const set = step("working");
  assert.ok(set.ok);
  assert.deepEqual(set.changes, [{ kind: "upserted", entity: { ...browser("working"), step: "Opening page" } }]);
  assert.deepEqual(step("paused"), { ok: false, rejection: { kind: "invalid", action: "browserStep", from: "paused" } });
  const busy = { ...browser("working"), step: "Clicking" };
  const take = decide(stateOf(busy), { method: "browser.control", params: { id: "b1", action: "take" } }, ctx);
  assert.ok(take.ok && take.changes[0]?.kind === "upserted" && take.changes[0].entity.kind === "browser" && take.changes[0].entity.step === null);
  const ended = decideAgent(stateOf(busy), "browserEnded", { kind: "browserEnded", id: "b1", status: "completed", result: "ok" }, ctx);
  assert.ok(ended.ok && ended.changes[0]?.kind === "upserted" && ended.changes[0].entity.kind === "browser" && ended.changes[0].entity.step === null);
});

test("'always' is an answer only where a rule can hold it", () => {
  const once = stateOf({ kind: "approval", id: "a1", at, action: "Click Pay", target: "shop.example", detail: "d", remember: false, status: "pending", expires: at });
  assert.deepEqual(decide(once, { method: "approval.resolve", params: { id: "a1", resolution: "allow_always" } }, ctx), {
    ok: false,
    rejection: { kind: "invalid", action: "always", from: "pending" },
  });
  assert.ok(decide(once, { method: "approval.resolve", params: { id: "a1", resolution: "allow_once" } }, ctx).ok);
});
