import assert from "node:assert/strict";
import { test } from "node:test";
import { type Browser, type BrowserStatus, type Entity, type State, apply, empty } from "@amuse/protocol";
import { type Change, type Context, decide, decideAgent, place, recover } from "./decide.ts";

const at = "2026-10-20T08:00:00Z";
const ctx: Context = { now: at, id: (prefix) => `${prefix}1` };
const record = (state: State, changes: Change[]): State =>
  changes.reduce((s, change) => apply(s, { seq: s.seq + 1, event: place(s, change) }), state);
const stateOf = (...entities: Entity[]): State => record(empty, entities.map((entity) => ({ kind: "upserted", entity })));
const browser = (status: BrowserStatus, live = true): Browser => ({ kind: "browser", id: "b1", at, title: "Log in", url: "https://x.example/", status, instructions: "Log in", result: null, step: null, live, outcome: null, files: [] });

test("chat.send records the prompt and asks the agent", () => {
  const d = decide(empty, { method: "chat.send", params: { chat: "main", text: "hi", timezone: "Asia/Shanghai", attachments: [] } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.output, { id: "p1" });
  assert.deepEqual(d.changes, [{ kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hi", timezone: "Asia/Shanghai", attachments: [] } }]);
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "hi", attachments: [] }]);
});

type Move = "take" | "handBack" | "stop";

test("browser moves follow Amuse: take → paused, handBack → working (on a job), stop → stopped", () => {
  const moves: [BrowserStatus, Move, BrowserStatus][] = [
    ["working", "take", "paused"],
    ["needs_you", "take", "paused"],
    ["completed", "take", "paused"],
    ["idle", "take", "paused"],
    ["paused", "handBack", "working"],
    ["waiting", "stop", "stopped"],
    ["idle", "stop", "stopped"],
  ];
  for (const [from, action, to] of moves) {
    const d = decide(stateOf(browser(from)), { method: "browser.control", params: { id: "b1", action } }, ctx);
    assert.ok(d.ok, `${action} from ${from}`);
    const moved = browser(to, action !== "stop"); // a stopped run's browser closes at once
    assert.deepEqual(d.changes, [{ kind: "upserted", entity: moved }]);
    assert.deepEqual(d.effects, [{ kind: "browser", browser: moved, action }]);
  }
});

test("illegal browser moves are rejected with where they came from", () => {
  const illegal: [BrowserStatus, Move][] = [
    ["stopped", "take"],
    ["working", "handBack"],
    ["completed", "stop"],
    ["failed", "take"],
  ];
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
  const pending = stateOf({ kind: "approval", id: "a1", at, action: "Send", target: "t", detail: "d", remember: true, status: "pending", expires: at, app: null });
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
  const task = (status: "working" | "completed"): Entity => ({ kind: "task", id: "t1", at, title: "T", steps: [], status, instructions: "", result: null });
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

  const browse = decideAgent(empty, "browse", { kind: "browse", title: "Tides", url: "https://tides.example/", instructions: "Read today's tides", files: [] }, ctx);
  assert.ok(browse.ok);
  const run: Browser = { kind: "browser", id: "b1", at, title: "Tides", url: "https://tides.example/", status: "working", instructions: "Read today's tides", result: null, step: null, live: true, outcome: null, files: [] };
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

test("a browser being viewed takes the view's shape, whoever drives it; back to the standard size after; not once gone", () => {
  const fit = (b: Browser, view: { width: number; height: number } | null) => decide(stateOf(b), { method: "browser.fit", params: { id: "b1", view } }, ctx);
  const viewed = fit(browser("working"), { width: 390, height: 560 });
  assert.ok(viewed.ok);
  assert.deepEqual(viewed.changes, []);
  assert.deepEqual(viewed.effects, [{ kind: "fit", id: "b1", viewer: { width: 390, height: 560 } }]);
  const left = fit(browser("idle"), null);
  assert.ok(left.ok);
  assert.deepEqual(left.effects, [{ kind: "fit", id: "b1", viewer: null }]);
  assert.deepEqual(fit(browser("idle", false), null), { ok: false, rejection: { kind: "gone", id: "b1" } });
});

test("a browser stays open between jobs: a job ends idle, the next goes to the same browser, and only when it is idle", () => {
  const ended = decideAgent(stateOf(browser("working")), "browserEnded", { kind: "browserEnded", id: "b1", status: "completed", result: "Logged in" }, ctx);
  assert.ok(ended.ok);
  const idle: Browser = { ...browser("idle"), result: "Logged in", outcome: "completed" };
  assert.deepEqual(ended.changes, [{ kind: "upserted", entity: idle }]);
  const next = decideAgent(stateOf(idle), "browserJob", { kind: "browserJob", id: "b1", title: "Download the bill", instructions: "Download October's bill", files: [] }, ctx);
  assert.ok(next.ok);
  const working: Browser = { ...idle, title: "Download the bill", instructions: "Download October's bill", status: "working", result: null, outcome: null };
  assert.deepEqual(next.changes, [{ kind: "upserted", entity: working }]);
  assert.deepEqual(next.effects, [{ kind: "job", browser: working }]);
  assert.deepEqual(decideAgent(stateOf(browser("working")), "browserJob", { kind: "browserJob", id: "b1", title: "x", instructions: "x", files: [] }, ctx), {
    ok: false,
    rejection: { kind: "invalid", action: "browserJob", from: "working" },
  });
  assert.deepEqual(decideAgent(stateOf(browser("idle", false)), "browserJob", { kind: "browserJob", id: "b1", title: "x", instructions: "x", files: [] }, ctx), {
    ok: false,
    rejection: { kind: "gone", id: "b1" },
  });
  // between jobs it is not told things in passing, nor asks
  assert.deepEqual(decideAgent(stateOf(idle), "instruct", { kind: "instruct", run: "b1", text: "x" }, ctx), { ok: false, rejection: { kind: "invalid", action: "instruct", from: "idle" } });
});

test("the user's own browser: held by them from the start; handed back with no job on, it is idle; closed from idle", () => {
  const opened = decide(empty, { method: "browser.open", params: { chat: "main", url: "https://www.google.com/" } }, ctx);
  assert.ok(opened.ok);
  const mine = opened.changes[0]?.kind === "upserted" ? opened.changes[0].entity : null;
  assert.ok(mine?.kind === "browser" && mine.status === "paused" && mine.instructions === "" && mine.live);
  assert.deepEqual(opened.effects, [{ kind: "browse", browser: mine }]);
  const back = decide(stateOf(mine), { method: "browser.control", params: { id: mine.id, action: "handBack" } }, ctx);
  assert.ok(back.ok && back.changes[0]?.kind === "upserted" && back.changes[0].entity.kind === "browser" && back.changes[0].entity.status === "idle");
  const onAJob = decide(stateOf(browser("paused")), { method: "browser.control", params: { id: "b1", action: "handBack" } }, ctx);
  assert.ok(onAJob.ok && onAJob.changes[0]?.kind === "upserted" && onAJob.changes[0].entity.kind === "browser" && onAJob.changes[0].entity.status === "working");
  const closed = decide(stateOf(browser("idle")), { method: "browser.control", params: { id: "b1", action: "stop" } }, ctx);
  assert.ok(closed.ok && closed.changes[0]?.kind === "upserted" && closed.changes[0].entity.kind === "browser" && !closed.changes[0].entity.live);
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

test("a job ends with what came of it, from in flight or from the user's hold; not once the browser is stopped", () => {
  const end = (from: BrowserStatus) =>
    decideAgent(stateOf(browser(from)), "browserEnded", { kind: "browserEnded", id: "b1", status: "completed", result: "Found it" }, ctx);
  const ended = end("working");
  assert.ok(ended.ok);
  assert.deepEqual(ended.changes, [{ kind: "upserted", entity: { ...browser("idle"), result: "Found it", outcome: "completed" } }]);
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
  const once = stateOf({ kind: "approval", id: "a1", at, action: "Click Pay", target: "shop.example", detail: "d", remember: false, status: "pending", expires: at, app: null });
  assert.deepEqual(decide(once, { method: "approval.resolve", params: { id: "a1", resolution: "allow_always" } }, ctx), {
    ok: false,
    rejection: { kind: "invalid", action: "always", from: "pending" },
  });
  assert.ok(decide(once, { method: "approval.resolve", params: { id: "a1", resolution: "allow_once" } }, ctx).ok);
});
