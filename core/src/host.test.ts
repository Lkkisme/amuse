import assert from "node:assert/strict";
import { test } from "node:test";
import { type Schedule, type Session, type State, apply, prepend } from "@remuse/protocol";
import { type AgentIO, type Ports, type Timers, createHost, memoryChats, memoryRules } from "./index.ts";

/** Ports that do nothing but hand over the AgentIO, so tests can act like an agent. */
function capture() {
  let io: AgentIO | undefined;
  const runs: Schedule[] = [];
  const ports: Ports = {
    prompt: (_, agent) => void (io = agent),
    title: async (text) => text.split(" ").slice(0, 3).join(" "),
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
  await host.call("chat.send", { chat: "main", text: "go", timezone: "UTC" });
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
  await host.call("chat.send", { chat: "main", text: "go", timezone: "UTC" });
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
  for (const text of ["a", "b", "c", "d", "e"]) await host.call("chat.send", { chat: "main", text, timezone: "UTC" });
  const agent = io();
  assert.ok(agent);
  const run = agent.act({ kind: "browse", title: "t", url: "https://x.example/", instructions: "t" });
  assert.ok(run.ok);
  for (const text of ["f", "g", "h", "i"]) await host.call("chat.send", { chat: "main", text, timezone: "UTC" });

  const synced = await host.call("session.sync", { chat: "main", since: null });
  assert.ok(synced.kind === "snapshot");
  let client = synced.state;
  assert.equal(client.earlier, 5); // reaches back to the run still in play
  host.subscribe((u) => {
    if (u.kind === "event") client = apply(client, u.envelope);
  });

  agent.act({ kind: "browserEnded", id: run.id, status: "completed", result: "done" });
  await host.call("chat.send", { chat: "main", text: "j", timezone: "UTC" });
  while (client.earlier > 0) {
    const page = await host.call("session.history", { chat: "main", before: client.earlier, limit: 2 });
    const next = prepend(client, page);
    assert.ok(next);
    client = next;
  }
  const whole = await wholeFeed(host);
  assert.deepEqual(client, whole);
});

/** The whole feed, as a client with an unlimited window would hold it. */
async function wholeFeed(host: Session): Promise<State> {
  const page = await host.call("session.history", { chat: "main", before: Number.MAX_SAFE_INTEGER, limit: 200 });
  const synced = await host.call("session.sync", { chat: "main", since: null });
  assert.ok(synced.kind === "snapshot");
  return { ...synced.state, earlier: 0, entities: page.entities };
}

test("a schedule runs in the background when its time comes, and again the next day", async () => {
  const { ports, io, runs } = capture();
  const time = manualTime("2026-10-20T08:00:00Z");
  const host = createHost(ports, { clock: time.clock, timers: time.timers });
  await host.call("chat.send", { chat: "main", text: "brief me at 8", timezone: "Asia/Shanghai" });
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
  await host.call("chat.send", { chat: "main", text: "send it", timezone: "UTC" });
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

/** A host with one browser run in flight, and the agent's IO. */
async function withRun() {
  const { ports, io, runs } = capture();
  const time = manualTime("2026-10-20T08:00:00Z");
  const host = createHost(ports, { clock: time.clock, timers: time.timers });
  await host.call("chat.send", { chat: "main", text: "check the tides", timezone: "UTC" });
  const agent = io();
  assert.ok(agent);
  const run = agent.act({ kind: "browse", title: "Tides", url: "https://tides.example/", instructions: "Read today's tides" });
  assert.ok(run.ok);
  const entity = async (id: string) => (await host.call("session.history", { chat: "main", before: 1000, limit: 200 })).entities.find((e) => e.id === id);
  return { host, agent, run: run.id, time, runs, entity };
}

test("Muse tells a run in flight something more: it is recorded, and the run hears it; a run that ended hears nothing", async () => {
  const { host, agent, run, entity } = await withRun();
  const heard: string[] = [];
  const stop = agent.listen(run, (m) => heard.push(m.kind === "instruction" ? m.text : "stop"));
  const told = agent.act({ kind: "instruct", run, text: "Also check tomorrow" });
  assert.ok(told.ok);
  assert.deepEqual(heard, ["Also check tomorrow"]);
  assert.equal((await entity(told.id))?.kind, "instruction");
  stop();
  await host.call("browser.control", { id: run, action: "stop" });
  assert.deepEqual(agent.act({ kind: "instruct", run, text: "and the day after" }), { ok: false, rejection: { kind: "notRunning", id: run } });
});

test("a run's question waits for Muse's answer; the run waits for the user meanwhile; one answer only", async () => {
  const { agent, run, entity } = await withRun();
  const asked = agent.act({ kind: "question", run, text: "Which beach?" });
  assert.ok(asked.ok);
  const browser = await entity(run);
  assert.equal(browser?.kind === "browser" && browser.status, "waiting");
  const answer = agent.answer(asked.id);
  assert.ok(agent.act({ kind: "answer", id: asked.id, text: "Ocean Beach" }).ok);
  assert.deepEqual(await answer, { kind: "answered", text: "Ocean Beach" });
  assert.deepEqual(await agent.answer(asked.id), { kind: "answered", text: "Ocean Beach" }, "asked again after the fact");
  assert.deepEqual(agent.act({ kind: "answer", id: asked.id, text: "Baker Beach" }), { ok: false, rejection: { kind: "invalid", action: "answer", from: "answered" } });
});

test("a question nobody answers times out; one whose run ends is closed", async () => {
  const { agent, run, time } = await withRun();
  const late = agent.act({ kind: "question", run, text: "Which beach?" });
  assert.ok(late.ok);
  const waiting = agent.answer(late.id);
  time.advance(30 * 60_000);
  assert.deepEqual(await waiting, { kind: "timed_out" });
  const left = agent.act({ kind: "question", run, text: "Morning or evening?" });
  assert.ok(left.ok);
  const unanswered = agent.answer(left.id);
  agent.act({ kind: "browserEnded", id: run, status: "completed", result: "Low tide at 9" });
  assert.deepEqual(await unanswered, { kind: "closed" });
});

test("Muse stops a run in flight, but not one the user holds; a schedule's run hears the stop", async () => {
  const { host, agent, run, entity, time, runs } = await withRun();
  await host.call("browser.control", { id: run, action: "take" });
  assert.deepEqual(agent.act({ kind: "stopRun", run }), { ok: false, rejection: { kind: "invalid", action: "stopRun", from: "paused" } });
  await host.call("browser.control", { id: run, action: "handBack" });
  assert.ok(agent.act({ kind: "stopRun", run }).ok);
  const browser = await entity(run);
  assert.equal(browser?.kind === "browser" && browser.status, "stopped");

  const made = agent.act({ kind: "schedule", title: "Hourly", instructions: "Look at the mail", when: { kind: "repeat", cron: "0 * * * *", timezone: "UTC" } });
  assert.ok(made.ok);
  time.advance(60 * 60_000);
  assert.equal(runs.length, 1);
  const heard: string[] = [];
  agent.listen(made.id, (m) => heard.push(m.kind));
  assert.ok(agent.act({ kind: "stopRun", run: made.id }).ok);
  assert.deepEqual(heard, ["stop"]);
});

test("side chats: each its own feed and agent, named after its first message, listed by use, renamed, deleted", async () => {
  const { ports, io } = capture();
  const time = manualTime("2026-10-20T08:00:00Z");
  const store = memoryChats();
  const host = createHost(ports, { clock: time.clock, timers: time.timers, store });
  const pushed: string[][] = [];
  host.subscribe((u) => void (u.kind === "chats" && pushed.push(u.chats.map((c) => c.title))));
  await host.call("chat.send", { chat: "main", text: "hello main", timezone: "UTC" });
  const side = await host.call("chats.create", {});
  time.advance(60_000);
  await host.call("chat.send", { chat: side.id, text: "plan the trip please", timezone: "UTC" });
  await new Promise((r) => setImmediate(r)); // the title arrives
  const agent = io();
  assert.equal(agent?.chat, side.id, "the side chat's agent answers it");

  const { chats } = await host.call("chats.list", {});
  assert.deepEqual(chats.map((c) => [c.id === "main" ? "main" : "side", c.title]), [["main", ""], ["side", "plan the trip"]]);
  assert.ok(pushed.some((titles) => titles.includes("plan the trip")));
  const feeds = await Promise.all(["main", side.id].map((chat) => host.call("session.history", { chat, before: 100, limit: 100 })));
  assert.deepEqual(feeds.map((f) => f.entities.map((e) => (e.kind === "prompt" ? e.text : e.kind))), [["hello main"], ["plan the trip please"]]);

  // the side chat's agent sees only its chat, and can read and search the others
  assert.ok(agent);
  assert.doesNotMatch(agent.context(), /hello main/);
  assert.match(agent.readChat("main") ?? "", /hello main/);
  assert.match(agent.recall("hello", true), /In "Main chat" \(main\):[\s\S]*hello main/);
  assert.deepEqual(agent.chats().map((c) => c.title), ["Main chat", "plan the trip"]);

  // a schedule set up in a side chat lives in the main chat, where its runs report
  const made = agent.act({ kind: "schedule", title: "Briefing", instructions: "x", when: { kind: "repeat", cron: "0 8 * * *", timezone: "UTC" } });
  assert.ok(made.ok);
  const mainFeed = await host.call("session.history", { chat: "main", before: 100, limit: 100 });
  assert.ok(mainFeed.entities.some((e) => e.id === made.id));

  await host.call("chats.rename", { id: side.id, title: "Trip" });
  assert.equal((await host.call("chats.list", {})).chats[1]?.title, "Trip");
  await assert.rejects(host.call("chats.rename", { id: "main", title: "x" }), /main chat cannot be renamed/);
  await host.call("chats.delete", { id: side.id });
  assert.equal((await host.call("chats.list", {})).chats.length, 1);
  await assert.rejects(host.call("session.sync", { chat: side.id, since: null }), /no chat/);
});

test("chats and their feeds survive a restart", async () => {
  const store = memoryChats();
  const first = createHost(capture().ports, { store, timers: manualTime("2026-10-20T08:00:00Z").timers });
  const side = await first.call("chats.create", {});
  await first.call("chat.send", { chat: side.id, text: "remember this", timezone: "UTC" });
  const second = createHost(capture().ports, { store, timers: manualTime("2026-10-20T08:00:00Z").timers });
  const { chats } = await second.call("chats.list", {});
  assert.deepEqual(chats.map((c) => c.id), ["main", side.id]);
  const synced = await second.call("session.sync", { chat: side.id, since: null });
  assert.ok(synced.kind === "snapshot" && synced.state.entities.some((e) => e.kind === "prompt" && e.text === "remember this"));
});
