import assert from "node:assert/strict";
import { test } from "node:test";
import { type Browser, type BrowserStatus, type Entity, type State, apply, empty } from "@remuse/protocol";
import { type Context, decide, decideAgent } from "./decide.ts";

const at = "2026-10-20T08:00:00Z";
const ctx: Context = { now: at, id: (prefix) => `${prefix}1` };
const stateOf = (...entities: Entity[]): State =>
  entities.reduce((s, entity, i) => apply(s, { seq: i + 1, event: { kind: "upserted", entity } }), empty);
const browser = (status: BrowserStatus): Browser => ({ kind: "browser", id: "b1", at, title: "Log in", url: "https://x.example/", status });

test("chat.send records the prompt and asks the agent", () => {
  const d = decide(empty, { method: "chat.send", params: { text: "hi" } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.output, { id: "p1" });
  assert.deepEqual(d.events, [{ kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hi" } }]);
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "hi" }]);
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
    assert.deepEqual(d.events, [{ kind: "upserted", entity: browser(to) }]);
    assert.deepEqual(d.effects, [{ kind: "browser", browser: browser(to), action }]);
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
  const pending = stateOf({ kind: "approval", id: "a1", at, action: "Send", target: "t", detail: "d", status: "pending" });
  const allow = decide(pending, { method: "approval.resolve", params: { id: "a1", resolution: "allow_always" } }, ctx);
  assert.ok(allow.ok && allow.events[0]?.kind === "upserted" && allow.events[0].entity.kind === "approval");
  assert.equal(allow.events[0].entity.status, "approved");
  const deny = decide(pending, { method: "approval.resolve", params: { id: "a1", resolution: "deny_always" } }, ctx);
  assert.ok(deny.ok && deny.events[0]?.kind === "upserted" && deny.events[0].entity.kind === "approval");
  assert.equal(deny.events[0].entity.status, "denied");
  const resolved = allow.events.reduce((s, event, i) => apply(s, { seq: s.seq + i + 1, event }), pending);
  assert.deepEqual(decide(resolved, { method: "approval.resolve", params: { id: "a1", resolution: "deny" } }, ctx), {
    ok: false,
    rejection: { kind: "invalid", action: "resolve", from: "approved" },
  });
});

test("chat.stop ends streaming replies and the activity, then interrupts", () => {
  const streaming = stateOf({ kind: "reply", id: "r1", at, text: "Hel", streaming: true });
  const d = decide(streaming, { method: "chat.stop", params: {} }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.events, [
    { kind: "upserted", entity: { kind: "reply", id: "r1", at, text: "Hel", streaming: false } },
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
  const state = first.events.reduce((s, event, i) => apply(s, { seq: i + 1, event }), empty);
  const again = decideAgent(state, "connect", { kind: "connect", provider: "gmail", title: "Gmail" }, ctx);
  assert.ok(again.ok);
  assert.deepEqual(again.events, []);
  assert.equal(again.output.id, first.output.id);

  const browse = decideAgent(empty, "browse", { kind: "browse", title: "Tides", url: "https://tides.example/" }, ctx);
  assert.ok(browse.ok);
  const run: Browser = { kind: "browser", id: "b1", at, title: "Tides", url: "https://tides.example/", status: "working" };
  assert.deepEqual(browse.events, [{ kind: "upserted", entity: run }]);
  assert.deepEqual(browse.effects, [{ kind: "browse", browser: run }]);
});
