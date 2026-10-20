import assert from "node:assert/strict";
import { test } from "node:test";
import { type Schedule, type Session, type State, apply, prepend } from "@remuse/protocol";
import { type AgentIO, type Ports, type Timers, createHost, memoryRules } from "./index.ts";

/** Ports that do nothing but hand over the AgentIO, so tests can act like an agent. */
function capture() {
  let io: AgentIO | undefined;
  const runs: Schedule[] = [];
  const ports: Ports = {
    prompt: (_, agent) => void (io = agent),
    schedule: (schedule, agent) => {
      io = agent;
      runs.push(schedule);
    },
    interrupt: () => {},
    browse: () => {},
    browser: () => {},
    approval: () => {},
    stopTask: () => {},
    fit: () => {},
    connect: async () => "https://connect.example/",
    apps: {
      search: async () => ({ apps: [], cursor: null }),
      accounts: async () => [],
      connect: async () => "https://connect.example/",
      disconnect: async () => {},
      permissions: async () => [],
      permit: async () => {},
    },
    rules: memoryRules(),
  };
  return { ports, io: () => io, runs };
}

/** A clock and timers the test moves by hand. */
function manualTime(start: string) {
  let now = Date.parse(start);
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  const timers: Timers<number> = {
    set: (ms, fn) => {
      pending.set(++next, { at: now + ms, fn });
      return next;
    },
    clear: (handle) => void pending.delete(handle),
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  return { clock: { now: () => new Date(now).toISOString() }, timers, advance, waiting: () => pending.size };
}

test("a decision already made is answered at once; one still open waits for the user", async () => {
  const { ports, io } = capture();
  const host = createHost(ports);
  await host.call("chat.send", { text: "go", timezone: "UTC" });
  const agent = io();
  assert.ok(agent);
  const asked = agent.act({ kind: "ask", action: "send", target: "gmail", detail: "{}", remember: true });
  assert.ok(asked.ok);
  const early = agent.decision(asked.id);
  await host.call("approval.resolve", { id: asked.id, resolution: "allow_once" });
  assert.deepEqual(await early, { verdict: "approved", remember: false });
  assert.deepEqual(await agent.decision(asked.id), { verdict: "approved", remember: false }); // asked again after the fact
});

test("an agent cannot move a run the user stopped", async () => {
  const { ports, io } = capture();
  const host = createHost(ports);
  await host.call("chat.send", { text: "go", timezone: "UTC" });
  const agent = io();
  assert.ok(agent);
  const started = agent.act({ kind: "browse", title: "t", url: "https://x.example/", instructions: "t" });
  assert.ok(started.ok);
  await host.call("browser.control", { id: started.id, action: "stop" });
  assert.deepEqual(agent.act({ kind: "browserEnded", id: started.id, status: "completed", result: "done" }), {
    ok: false,
    rejection: { kind: "invalid", action: "browserEnded", from: "stopped" },
  });
});

test("a client holding only the recent end sees what the whole feed shows there, and pages back to all of it", async () => {
  const { ports, io } = capture();
  const host = createHost(ports, { snapshot: 3 });
  for (const text of ["a", "b", "c", "d", "e"]) await host.call("chat.send", { text, timezone: "UTC" });
  const agent = io();
  assert.ok(agent);
  const run = agent.act({ kind: "browse", title: "t", url: "https://x.example/", instructions: "t" });
  assert.ok(run.ok);
  for (const text of ["f", "g", "h", "i"]) await host.call("chat.send", { text, timezone: "UTC" });

  const synced = await host.call("session.sync", { since: null });
  assert.ok(synced.kind === "snapshot");
  let client = synced.state;
  assert.equal(client.earlier, 5); // reaches back to the run still in play
  host.subscribe((u) => (client = u.kind === "event" ? apply(client, u.envelope) : u.state));

  agent.act({ kind: "browserEnded", id: run.id, status: "completed", result: "done" });
  await host.call("chat.send", { text: "j", timezone: "UTC" });
  while (client.earlier > 0) {
    const page = await host.call("session.history", { before: client.earlier, limit: 2 });
    const next = prepend(client, page);
    assert.ok(next);
    client = next;
  }
  const whole = await wholeFeed(host);
  assert.deepEqual(client, whole);
});

/** The whole feed, as a client with an unlimited window would hold it. */
async function wholeFeed(host: Session): Promise<State> {
  const page = await host.call("session.history", { before: Number.MAX_SAFE_INTEGER, limit: 200 });
  const synced = await host.call("session.sync", { since: null });
  assert.ok(synced.kind === "snapshot");
  return { ...synced.state, earlier: 0, entities: page.entities };
}

test("a schedule runs in the background when its time comes, and again the next day", async () => {
  const { ports, io, runs } = capture();
  const time = manualTime("2026-10-20T08:00:00Z");
  const host = createHost(ports, { clock: time.clock, timers: time.timers });
  await host.call("chat.send", { text: "brief me at 8", timezone: "Asia/Shanghai" });
  const agent = io();
  assert.ok(agent);
  assert.deepEqual(agent.time(), { now: "2026-10-20T08:00:00.000Z", timezone: "Asia/Shanghai" });
  const made = agent.act({ kind: "schedule", title: "Briefing", instructions: "Sum up the day", when: { kind: "repeat", cron: "0 8 * * *", timezone: "Asia/Shanghai" } });
  assert.ok(made.ok);
  time.advance(15 * 60 * 60_000); // to 23:00 UTC, 07:00 in Shanghai
  assert.equal(runs.length, 0);
  time.advance(60 * 60_000);
  assert.deepEqual(runs.map((r) => r.next), ["2026-10-22T00:00:00.000Z"]);
  agent.act({ kind: "scheduleRan", id: made.id, outcome: "quiet", summary: "Nothing new" });
  time.advance(24 * 60 * 60_000);
  assert.equal(runs.length, 2);
  const { schedules } = await host.call("schedules.list", {});
  assert.equal(schedules[0]?.last?.outcome, "quiet");
});

test("an approval nobody answers times out, as a no to whoever waits on it", async () => {
  const { ports, io } = capture();
  const time = manualTime("2026-10-20T08:00:00Z");
  const host = createHost(ports, { clock: time.clock, timers: time.timers });
  await host.call("chat.send", { text: "send it", timezone: "UTC" });
  const agent = io();
  assert.ok(agent);
  const asked = agent.act({ kind: "ask", action: "send", target: "gmail", detail: "{}", remember: true });
  assert.ok(asked.ok);
  const answer = agent.decision(asked.id);
  time.advance(30 * 60_000);
  assert.deepEqual(await answer, { verdict: "timed_out", remember: false });
  await assert.rejects(host.call("approval.resolve", { id: asked.id, resolution: "allow_once" }), /cannot resolve from timed_out/);
  assert.equal(time.waiting(), 0, "nothing left to wait for");
});
