import assert from "node:assert/strict";
import { test } from "node:test";
import { type Approval, type Entity, type Schedule, type State, apply, empty } from "@amuse/protocol";
import { type Change, type Context, decide, decideAgent, place, recover, tick } from "./decide.ts";
import { APPROVAL_TTL_MS, GRACE_MS, MAX_SCHEDULES, check, deadline, later, localTime, nextRun, nowIn, wallClock } from "./schedule.ts";
import { agentContext } from "./context.ts";

const at = "2026-10-20T08:00:00Z"; // 16:00 in Shanghai
const ctx: Context = { now: at, id: (prefix) => `${prefix}1` };
const record = (state: State, changes: Change[]): State =>
  changes.reduce((s, change) => apply(s, { seq: s.seq + 1, event: place(s, change) }), state);
const stateOf = (...entities: Entity[]): State => record(empty, entities.map((entity) => ({ kind: "upserted", entity })));
const daily: Schedule = {
  kind: "schedule",
  id: "s1",
  at,
  title: "Morning briefing",
  instructions: "Sum up today's calendar",
  when: { kind: "repeat", cron: "0 8 * * *", timezone: "Asia/Shanghai" },
  status: "active",
  next: "2026-10-21T00:00:00Z",
  running: false,
  last: null,
  needs: null,
  preset: false,
  goal: null,
};

test("a cron runs on the user's clock, strictly after the given instant; a one-off once", () => {
  assert.equal(nextRun(daily.when, at), "2026-10-21T00:00:00Z".replace("Z", ".000Z"));
  assert.equal(nextRun({ kind: "once", at: "2026-10-21T00:00:00Z" }, at), "2026-10-21T00:00:00Z");
  assert.equal(nextRun({ kind: "once", at }, at), null);
  // across a daylight saving change: 08:00 local before and after it (Los Angeles falls back on 2026-11-01)
  const la: Schedule["when"] = { kind: "repeat", cron: "0 8 * * *", timezone: "America/Los_Angeles" };
  assert.equal(nextRun(la, "2026-10-31T16:00:00Z"), "2026-11-01T16:00:00.000Z");
  assert.equal(nextRun(la, "2026-11-01T16:00:00Z"), "2026-11-02T16:00:00.000Z");
});

test("a wall-clock time is read in the user's zone", () => {
  assert.equal(wallClock("2026-10-21 08:00", "Asia/Shanghai"), "2026-10-21T00:00:00.000Z");
  assert.equal(wallClock("tomorrow at 8", "Asia/Shanghai"), null);
  assert.equal(wallClock("2026-10-21 08:00", "Mars/Olympus"), null);
  assert.equal(localTime("2026-10-21T00:00:00Z", "Asia/Shanghai"), "2026-10-21 08:00");
});

test("a schedule the agent asks for must be sound: a real pattern and zone, not too often, not past", () => {
  const reason = (when: Schedule["when"]) => {
    const c = check(when, at);
    return c.ok ? null : c.reason;
  };
  assert.match(reason({ kind: "repeat", cron: "*/5 * * * *", timezone: "UTC" }) ?? "", /more often than every 15 minutes/);
  assert.match(reason({ kind: "repeat", cron: "0 0 8 * * *", timezone: "UTC" }) ?? "", /exactly five fields/);
  assert.match(reason({ kind: "repeat", cron: "0 99 * * *", timezone: "UTC" }) ?? "", /not a cron pattern/);
  assert.match(reason({ kind: "repeat", cron: "0 8 * * *", timezone: "Mars/Olympus" }) ?? "", /not a time zone/);
  assert.match(reason({ kind: "once", at: "2026-10-19T00:00:00Z" }) ?? "", /passed/);
  assert.equal(reason({ kind: "repeat", cron: "*/15 * * * *", timezone: "UTC" }), null);
  const hourly = check({ kind: "repeat", cron: "0 * * * *", timezone: "UTC" }, at);
  assert.ok(hourly.ok);
  assert.deepEqual(hourly.upcoming, ["2026-10-20T09:00:00.000Z", "2026-10-20T10:00:00.000Z", "2026-10-20T11:00:00.000Z"]);
});

test("the agent sets a schedule up, with its first run; no more than the limit", () => {
  const made = decideAgent(empty, "schedule", { kind: "schedule", title: daily.title, instructions: daily.instructions, when: daily.when }, ctx);
  assert.ok(made.ok);
  assert.deepEqual(made.changes, [{ kind: "upserted", entity: { ...daily, next: "2026-10-21T00:00:00.000Z" } }]);
  const full = stateOf(...Array.from({ length: MAX_SCHEDULES }, (_, i) => ({ ...daily, id: `s${i}` })));
  const over = decideAgent(full, "schedule", { kind: "schedule", title: "one more", instructions: "x", when: daily.when }, ctx);
  assert.deepEqual(over, { ok: false, rejection: { kind: "unsound", reason: `there are already ${MAX_SCHEDULES} schedules; cancel one first` } });
});

test("when its time comes a schedule runs once and moves on; a run ends with how it went", () => {
  const morning = "2026-10-21T00:00:30Z";
  const due = tick(stateOf(daily), morning);
  const running: Schedule = { ...daily, next: "2026-10-22T00:00:00.000Z", running: true };
  assert.deepEqual(due.changes, [{ kind: "upserted", entity: running }]);
  assert.deepEqual(due.effects, [{ kind: "run", schedule: running }]);
  // while it runs, it is not due again
  assert.deepEqual(tick(stateOf(running), "2026-10-22T00:00:30Z").effects, []);
  const ran = decideAgent(stateOf(running), "scheduleRan", { kind: "scheduleRan", id: "s1", outcome: "quiet", summary: "Nothing new" }, { ...ctx, now: morning });
  assert.ok(ran.ok);
  assert.deepEqual(ran.changes, [{ kind: "upserted", entity: { ...running, running: false, last: { at: morning, outcome: "quiet", summary: "Nothing new" } } }]);
});

test("a run too late to start is missed, not run; a one-off is done after its run", () => {
  const late = tick(stateOf(daily), later(daily.next ?? at, GRACE_MS + 60_000));
  assert.deepEqual(late.effects, []);
  assert.ok(late.changes[0]?.kind === "upserted" && late.changes[0].entity.kind === "schedule" && late.changes[0].entity.last?.outcome === "missed");
  const once: Schedule = { ...daily, when: { kind: "once", at: "2026-10-21T00:00:00Z" } };
  const ran = tick(stateOf(once), "2026-10-21T00:00:00Z");
  assert.deepEqual(ran.changes, [{ kind: "upserted", entity: { ...once, status: "done", next: null, running: true } }]);
});

test("the user pauses, resumes (from then on) and cancels a schedule", () => {
  const control = (state: State, action: "pause" | "resume" | "cancel", now = at) => decide(state, { method: "schedule.control", params: { id: "s1", action } }, { ...ctx, now });
  const paused = control(stateOf(daily), "pause");
  assert.ok(paused.ok);
  const pausedState = record(stateOf(daily), paused.changes);
  assert.deepEqual(tick(pausedState, "2026-10-25T00:00:00Z").effects, [], "a paused schedule does not run");
  const resumed = control(pausedState, "resume", "2026-10-25T03:00:00Z");
  assert.ok(resumed.ok);
  assert.deepEqual(resumed.changes, [{ kind: "upserted", entity: { ...daily, next: "2026-10-26T00:00:00.000Z" } }]);
  assert.deepEqual(control(stateOf(daily), "resume"), { ok: false, rejection: { kind: "invalid", action: "resume", from: "active" } });
  const cancelled = control(stateOf(daily), "cancel");
  assert.ok(cancelled.ok);
  assert.deepEqual(cancelled.changes, [{ kind: "upserted", entity: { ...daily, status: "cancelled", next: null } }]);
});

test("an unanswered approval times out, and the earliest deadline is what the host waits for", () => {
  const asked = decideAgent(stateOf(daily), "ask", { kind: "ask", action: "send email", target: "gmail", detail: "{}", remember: true }, ctx);
  assert.ok(asked.ok);
  const state = record(stateOf(daily), asked.changes);
  const expires = later(at, APPROVAL_TTL_MS);
  assert.equal(deadline(state), expires);
  const due = tick(state, expires);
  const approval = state.entities.find((e): e is Approval => e.kind === "approval");
  assert.ok(approval);
  assert.deepEqual(due.changes, [{ kind: "upserted", entity: { ...approval, status: "timed_out" } }]);
  assert.deepEqual(due.effects, [{ kind: "expired", id: approval.id }]);
  assert.equal(deadline(record(state, due.changes)), daily.next);
});

test("a run cut short by a restart is recorded as failed", () => {
  const running: Schedule = { ...daily, running: true };
  assert.deepEqual(recover(stateOf(running), at), [{ kind: "upserted", entity: { ...running, running: false, last: { at, outcome: "failed", summary: "cut short by a restart" } } }]);
});

test("the agent sees times on the user's clock, and its schedules", () => {
  const text = agentContext(stateOf({ kind: "prompt", id: "p1", at, text: "brief me at 8 every day", timezone: "Asia/Shanghai", attachments: [], quote: null }, daily));
  assert.equal(
    text,
    [
      "[2026-10-20 16:00] User: brief me at 8 every day",
      '[2026-10-20 16:00] Schedule s1 "Morning briefing" (active), cron "0 8 * * *" in Asia/Shanghai, next 2026-10-21 08:00',
      "  Instructions: Sum up today's calendar",
    ].join("\n"),
  );
});

test("now is told with the weekday, the user's local time and their zone", () => {
  assert.equal(nowIn("2026-10-21T07:30:00Z", "America/Los_Angeles"), "Wednesday 2026-10-21 00:30 (America/Los_Angeles)");
  assert.equal(nowIn("2026-10-21T07:30:00Z", "Nowhere/Else"), "Wednesday 2026-10-21 07:30 (UTC)");
});

test("a run its condition held back is skipped: it ends, and the last run stays what it was", () => {
  const before: Schedule["last"] = { at: "2026-10-20T00:00:00Z", outcome: "quiet", summary: "Nothing new" };
  const running: Schedule = { ...daily, running: true, last: before, needs: "conversation" };
  const skipped = decideAgent(stateOf(running), "scheduleRan", { kind: "scheduleRan", id: "s1", outcome: "skipped", summary: "" }, ctx);
  assert.ok(skipped.ok);
  assert.deepEqual(skipped.changes, [{ kind: "upserted", entity: { ...running, running: false, last: before } }]);
});

test("a schedule keeps what its runs wait for", () => {
  const made = decideAgent(empty, "schedule", { kind: "schedule", title: "Memory", instructions: "Tidy memory", when: daily.when, needs: "conversation" }, ctx);
  assert.ok(made.ok);
  const entity = made.changes[0]?.kind === "upserted" ? made.changes[0].entity : null;
  assert.equal(entity?.kind === "schedule" ? entity.needs : undefined, "conversation");
});
