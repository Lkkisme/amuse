import assert from "node:assert/strict";
import { test } from "node:test";
import type { Timers } from "@amuse/core";
import { type Decision, stretch } from "./budget.ts";

/** Timers the test moves by hand. */
function waiting() {
  const pending = new Map<number, { at: number; fn: () => void }>();
  let now = 0;
  let next = 0;
  const timers: Timers<number> = {
    set: (ms, fn) => (pending.set(++next, { at: now + ms, fn }), next),
    clear: (handle) => void pending.delete(handle),
  };
  return { timers, advance: (ms: number) => void ((now += ms), [...pending.entries()].filter(([, t]) => t.at <= now).forEach(([handle, t]) => (pending.delete(handle), t.fn()))) };
}

/** A run's budget, with what it said to Amuse and what ended it, and a stop the test can pull. */
function budget(overrides: { steps?: number; forMs?: number } = {}) {
  const clock = waiting();
  const said: string[] = [];
  const ended: string[] = [];
  const stop = new AbortController();
  const stretchBudget = stretch({
    steps: overrides.steps ?? 40,
    forMs: overrides.forMs ?? 30 * 60_000,
    timers: clock.timers,
    stop: stop.signal,
    paused: (report) => void said.push(report),
    // the port ends the run when a pause is not continued, and that closes it
    waitedOut: (report) => void (ended.push(report), stop.abort()),
  });
  return { stretchBudget, said, ended, advance: clock.advance, stop };
}

test("a stretch is 40 steps; a new job and a continue both start a fresh one", () => {
  const b = budget({ steps: 2 });
  assert.equal(b.stretchBudget.step(), true);
  assert.equal(b.stretchBudget.step(), true);
  assert.equal(b.stretchBudget.step(), false, "the stretch's steps are used up");
  assert.equal(b.stretchBudget.step(), false, "and no more of them are given");
  b.stretchBudget.fresh(); // a next job
  assert.equal(b.stretchBudget.step(), true);
});

test("a pause hands Amuse the report and waits; a message continues it with another stretch", async () => {
  const b = budget({ steps: 1 });
  assert.equal(b.stretchBudget.step(), true);
  assert.equal(b.stretchBudget.step(), false);
  const decided = b.stretchBudget.pause("4 of 6 modules checked; the last two need the calendar.");
  assert.deepEqual(b.said, ["4 of 6 modules checked; the last two need the calendar."], "Amuse hears it");
  assert.deepEqual(b.ended, [], "nothing ended it");
  assert.equal(b.stretchBudget.hear("Check the last two first"), true, "the message is the continue");
  assert.deepEqual(await decided, { kind: "continue", said: "Check the last two first" });
  assert.equal(b.stretchBudget.step(), true, "a continue is another stretch");
  assert.deepEqual(b.ended, []);
});

test("a message while the run is not paused is not a continue", () => {
  const b = budget();
  assert.equal(b.stretchBudget.hear("also check tomorrow"), false, "it goes to the run as an instruction");
  assert.equal(b.stretchBudget.step(), true);
});

test("a stop ends the pause: the run is stopped, and its report is not an ending", async () => {
  const b = budget();
  const decided: Promise<Decision> = b.stretchBudget.pause("halfway");
  b.stop.abort();
  assert.deepEqual(await decided, { kind: "stopped" });
  assert.deepEqual(b.ended, [], "the stop is its own ending");
  assert.deepEqual(await b.stretchBudget.pause("again"), { kind: "stopped" }, "a run that is stopped does not pause");
});

test("a pause nobody continues ends the run as stopped, with its report kept", async () => {
  const b = budget({ forMs: 30 * 60_000 });
  const decided = b.stretchBudget.pause("modules 4.08-5.08 opened, none checked");
  assert.deepEqual(b.ended, []);
  b.advance(29 * 60_000);
  assert.deepEqual(b.ended, [], "not yet");
  b.advance(60_000);
  assert.deepEqual(await decided, { kind: "stopped" });
  assert.deepEqual(b.ended, ["modules 4.08-5.08 opened, none checked"], "the report is what the run ended with");
  assert.deepEqual(await b.stretchBudget.pause("later"), { kind: "stopped" }, "and its stop already happened");
});
