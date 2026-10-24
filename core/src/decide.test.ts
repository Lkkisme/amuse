import assert from "node:assert/strict";
import { test } from "node:test";
import { type Browser, type BrowserStatus, type Entity, type State, apply, empty } from "@amuse/protocol";
import { type Change, type Context, MOST_REFUSALS_PER_HOUR, decide, decideAgent, place, recover } from "./decide.ts";

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
  assert.deepEqual(d.changes, [{ kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hi", timezone: "Asia/Shanghai", attachments: [], quote: null, suggested: false } }]);
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "hi", attachments: [], quote: null, suggested: false }]);
});

const schedule: Entity = { kind: "schedule", id: "s1", at, title: "Morning briefing", instructions: "Read the mail", when: { kind: "repeat", cron: "0 8 * * *", timezone: "UTC" }, status: "paused", next: null, running: false, last: null, needs: null, preset: false, goal: null };
const said: Entity = { kind: "reply", id: "r1", at, text: "It   is\nopen.", streaming: false, attachments: [], suggestions: [], chosen: null };
const send = (state: State, replyTo: string) => decide(state, { method: "chat.send", params: { chat: "main", text: "change this", timezone: "UTC", attachments: [], replyTo } }, ctx);

test("chat.send with replyTo keeps the item as it was, and gives it to the agent", () => {
  const card = send(stateOf(schedule), "s1");
  assert.ok(card.ok);
  const quote = { id: "s1", kind: "schedule", text: "Morning briefing", state: "paused" };
  assert.deepEqual(card.changes, [{ kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "change this", timezone: "UTC", attachments: [], quote, suggested: false } }]);
  assert.deepEqual(card.effects, [{ kind: "prompt", text: "change this", attachments: [], quote, suggested: false }]);
  const words = send(stateOf(said), "r1");
  assert.ok(words.ok);
  assert.deepEqual(words.effects, [{ kind: "prompt", text: "change this", attachments: [], quote: { id: "r1", kind: "reply", text: "It is open.", state: null }, suggested: false }]);
});

test("a message of either side can be replied to, and it has to be there; the agents' own exchanges cannot", () => {
  const mine: Entity = { kind: "prompt", id: "p0", at, text: "hi", timezone: "UTC", attachments: [], quote: null, suggested: false };
  assert.deepEqual(send(stateOf(mine), "nope"), { ok: false, rejection: { kind: "notFound", entity: "reply", id: "nope" } });
  const own = send(stateOf(mine), "p0");
  assert.ok(own.ok);
  assert.deepEqual(own.effects, [{ kind: "prompt", text: "change this", attachments: [], quote: { id: "p0", kind: "prompt", text: "hi", state: null }, suggested: false }]);
  const between: Entity = { kind: "instruction", id: "i1", at, run: "b1", title: "Log in", text: "more" };
  const d = send(stateOf(between), "i1");
  assert.ok(!d.ok && d.rejection.kind === "unsound");
});

test("chat.retry sends the user's last message again with the item it replied to", () => {
  const quote = { id: "s1", kind: "schedule" as const, text: "Morning briefing", state: "paused" };
  const asked: Entity = { kind: "prompt", id: "p0", at, text: "change this", timezone: "UTC", attachments: [], quote, suggested: false };
  const failure: Entity = { kind: "failure", id: "x1", at, reason: "failed", detail: "", turn: { kind: "message" }, status: "open" };
  const d = decide(stateOf(schedule, asked, failure), { method: "chat.retry", params: { id: "x1" } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "change this", attachments: [], quote, suggested: false }]);
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

test("stopping a browser that has already stopped is done, with nothing to change", () => {
  const d = decide(stateOf(browser("stopped")), { method: "browser.control", params: { id: "b1", action: "stop" } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.changes, []);
  assert.deepEqual(d.effects, []);
});

test("an approval resolves once; allow_* approves, deny_* denies", () => {
  const pending = stateOf({ kind: "approval", id: "a1", at, action: "Send", target: "t", detail: "d", remember: true, status: "pending", expires: at, app: null, always: false, byRule: false, lasting: false });
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
  const streaming = stateOf({ kind: "reply", id: "r1", at, text: "Hel", streaming: true, attachments: [], suggestions: [], chosen: null });
  const d = decide(streaming, { method: "chat.stop", params: { chat: "main" } }, ctx);
  assert.ok(d.ok);
  assert.deepEqual(d.changes, [
    { kind: "upserted", entity: { kind: "reply", id: "r1", at, text: "Hel", streaming: false, attachments: [], suggestions: [], chosen: null } },
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
  const busy = apply(stateOf({ kind: "reply", id: "r1", at, text: "Hal", streaming: true, attachments: [], suggestions: [], chosen: null }), {
    seq: 2,
    event: { kind: "activity", activity: { kind: "responding", label: null } },
  });
  assert.deepEqual(recover(busy, at), [
    { kind: "upserted", entity: { kind: "reply", id: "r1", at, text: "Hal", streaming: false, attachments: [], suggestions: [], chosen: null } },
    { kind: "activity", activity: null },
  ]);
  assert.deepEqual(recover(stateOf({ kind: "prompt", id: "p1", at, text: "hi", timezone: "UTC", attachments: [], quote: null, suggested: false }), at), []);
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
  const once = stateOf({ kind: "approval", id: "a1", at, action: "Click Pay", target: "shop.example", detail: "d", remember: false, status: "pending", expires: at, app: null, always: false, byRule: false, lasting: false });
  assert.deepEqual(decide(once, { method: "approval.resolve", params: { id: "a1", resolution: "allow_always" } }, ctx), {
    ok: false,
    rejection: { kind: "invalid", action: "always", from: "pending" },
  });
  assert.ok(decide(once, { method: "approval.resolve", params: { id: "a1", resolution: "allow_once" } }, ctx).ok);
});

test("a schedule every instance starts with takes this version's instructions; the user's own and a cancelled one stay as they are", () => {
  const preset: Entity = {
    kind: "schedule",
    id: "s1",
    at,
    title: "Skill review",
    instructions: "old wording",
    when: { kind: "repeat", cron: "0 4 * * *", timezone: "UTC" },
    status: "active",
    next: "2026-10-21T04:00:00Z",
    running: false,
    last: null,
    needs: "conversation",
    preset: true,
    goal: null,
  };
  const mine: Entity = { ...preset, id: "s2", title: "Skill review", preset: false, instructions: "mine" };
  const revise = (state: State) => decideAgent(state, "revisePreset", { kind: "revisePreset", title: "Skill review", instructions: "new wording" }, ctx);

  const revised = revise(stateOf(mine, preset));
  assert.ok(revised.ok);
  const after = record(stateOf(mine, preset), revised.changes);
  const instructions = (id: string) => {
    const found = after.entities.find((e) => e.id === id);
    return found?.kind === "schedule" ? found.instructions : null;
  };
  assert.equal(instructions("s1"), "new wording");
  assert.equal(instructions("s2"), "mine", "not the user's own of the same name");

  const cancelled = revise(stateOf({ ...preset, status: "cancelled", next: null }));
  assert.ok(cancelled.ok && cancelled.changes.length === 0, "a cancelled one stays cancelled, unchanged");
  const same = decideAgent(stateOf(preset), "revisePreset", { kind: "revisePreset", title: "Skill review", instructions: "old wording" }, ctx);
  assert.ok(same.ok && same.changes.length === 0, "nothing to record when it is the same");
});

test("a refusal by the user's rule is one record however often the agent retries; varied wording is capped; an hour later is a new one", () => {
  const refuse = (state: State, now: string, action = "Visit", target = "bank.com", app: string | null = null) => {
    const d = decideAgent(state, "refuse", { kind: "refuse", action, target, detail: "x", app }, { now, id: (p) => `${p}-${now}-${action}-${target}-${app}` });
    assert.ok(d.ok);
    return { d, state: record(state, d.changes) };
  };
  const refusals = (s: State) => s.entities.filter((e) => e.kind === "approval" && e.byRule);
  let s = empty;
  const first = refuse(s, "2026-10-20T08:00:00Z");
  s = first.state;
  const idOf = (state: State) => refusals(state)[0]?.id;
  // the same action and target again, many times in a few minutes: still one, as of the latest
  for (let minute = 1; minute < 9; minute++) {
    const again = refuse(s, `2026-10-20T08:0${minute}:00Z`);
    assert.deepEqual(again.d.output, { id: idOf(first.state) });
    s = again.state;
  }
  assert.equal(refusals(s).length, 1);
  assert.equal(refusals(s)[0]?.at, "2026-10-20T08:08:00Z");
  // another action, another target or another app is another record
  s = refuse(s, "2026-10-20T08:09:00Z", "Submit").state;
  s = refuse(s, "2026-10-20T08:09:00Z", "Visit", "news.example").state;
  s = refuse(s, "2026-10-20T08:09:00Z", "Visit", "bank.com", "gmail").state;
  assert.equal(refusals(s).length, 4);
  // well after the window, the same refusal is a new record
  s = refuse(s, "2026-10-20T09:30:00Z").state;
  assert.equal(refusals(s).length, 5);
  // a flood of differently worded ones is capped within an hour; the step is still refused (the decision is ok)
  let flood = empty;
  for (let i = 0; i < MOST_REFUSALS_PER_HOUR + 20; i++) flood = refuse(flood, "2026-10-20T08:00:00Z", `Visit ${i}`, `site${i}.example`).state;
  assert.equal(refusals(flood).length, MOST_REFUSALS_PER_HOUR);
  const later = refuse(flood, "2026-10-20T10:00:00Z", "Visit again", "other.example");
  assert.equal(refusals(later.state).length, MOST_REFUSALS_PER_HOUR + 1, "an hour on, recording goes on");
  // a refusal that was recorded is never a card to answer
  assert.ok(refusals(s).every((e) => e.kind === "approval" && e.status === "denied" && !e.remember));
});

test("chat.send with about quotes an error as the user read it, and keeps its detail for the agent, redacted", () => {
  const about = { message: "Voice needs a key", detail: "feature: voice; provider: OpenAI; error: 401 Bearer abcdefghijklmnop sk-abcdefghijklmnopqrstuv" };
  const d = decide(stateOf(said), { method: "chat.send", params: { chat: "main", text: "I ran into this", timezone: "UTC", attachments: [], about } }, ctx);
  assert.ok(d.ok);
  const quote = { id: "e1", kind: "error", text: "Voice needs a key", state: null, detail: "feature: voice; provider: OpenAI; error: 401 Bearer <redacted> <redacted>" };
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "I ran into this", attachments: [], quote, suggested: false }]);
  assert.deepEqual(d.changes, [{ kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "I ran into this", timezone: "UTC", attachments: [], quote, suggested: false } }]);
});

const offer: Entity = { kind: "reply", id: "r1", at, text: "Shall I book it?", streaming: false, attachments: [], suggestions: ["Book it", "Not now"], chosen: null };
const tap = (state: State, text: string, index: number) => decide(state, { method: "chat.send", params: { chat: "main", text, timezone: "UTC", attachments: [], suggested: { reply: "r1", index } } }, ctx);
const typed: Entity = { kind: "prompt", id: "p0", at, text: "something else", timezone: "UTC", attachments: [], quote: null, suggested: false };

test("tapping a suggested reply sends its words as a message, marks it, and stores the choice on the reply", () => {
  const d = tap(stateOf(offer), "Not now", 1);
  assert.ok(d.ok);
  assert.deepEqual(d.changes, [
    { kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "Not now", timezone: "UTC", attachments: [], quote: null, suggested: true } },
    { kind: "upserted", entity: { ...offer, chosen: 1 } },
  ]);
  assert.deepEqual(d.effects, [{ kind: "prompt", text: "Not now", attachments: [], quote: null, suggested: true }]);
});

test("a suggested reply is closed once one is chosen, or once the user has written anything newer", () => {
  const chosen: Entity = { ...offer, chosen: 0 };
  assert.ok(!tap(stateOf(chosen), "Not now", 1).ok, "one choice only");
  assert.ok(!tap(stateOf(offer, typed), "Book it", 0).ok, "a newer message of the user's closes it");
  assert.ok(tap(stateOf(typed, offer), "Book it", 0).ok, "an older one does not");
  assert.ok(!tap(stateOf(offer), "Book it", 1).ok, "the words must be the option's");
  assert.ok(!tap(stateOf(offer), "Book it", 5).ok, "the option must be there");
  assert.ok(!tap(stateOf(), "Book it", 0).ok, "the reply must be there");
});
