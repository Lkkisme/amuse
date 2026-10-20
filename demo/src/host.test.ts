import assert from "node:assert/strict";
import { test } from "node:test";
import { type Envelope, type State, apply, empty } from "@remuse/protocol";
import { type AgentIO, Rejected, type Timers, createHost } from "@remuse/core";
import { demoPorts, seed } from "./index.ts";

/** Timers that only fire when the test says so. */
function manualTimers() {
  let now = 0;
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
  return { timers, advance };
}

const clock = { now: () => "2026-10-20T08:00:00Z" };

/** A client view like the web's: snapshot first, then events. */
async function setup() {
  const { timers, advance } = manualTimers();
  const host = createHost(demoPorts(timers), { seed: seed(), clock });
  const synced = await host.call("session.sync", { since: null });
  let state: State = synced.kind === "snapshot" ? synced.state : empty;
  host.subscribe((u) => (state = u.kind === "event" ? apply(state, u.envelope) : u.state));
  return { host, advance, view: () => state };
}

test("sync from nothing returns the seeded snapshot; sync from a seq returns the rest", async () => {
  const { host } = await setup();
  const snapshot = await host.call("session.sync", { since: null });
  assert.equal(snapshot.kind, "snapshot");
  assert.ok(snapshot.kind === "snapshot" && snapshot.state.entities.length === seed().length);
  const rest = await host.call("session.sync", { since: 10 });
  assert.ok(rest.kind === "events" && rest.events.every((e) => e.seq > 10));
});

test("a prompt streams a reply and clears the activity", async () => {
  const { host, advance, view } = await setup();
  const { id } = await host.call("chat.send", { text: "hi" });
  assert.equal(view().entities.at(-1)?.id, id);
  assert.equal(view().activity?.kind, "responding");
  advance(10_000);
  const last = view().entities.at(-1);
  assert.ok(last?.kind === "reply" && !last.streaming && last.text.includes("hi"));
  assert.equal(view().activity, null);
});

test("chat.stop cuts the reply mid-stream and nothing arrives afterwards", async () => {
  const { host, advance, view } = await setup();
  await host.call("chat.send", { text: "a long answer please" });
  advance(1500); // reply started, a few words in
  await host.call("chat.stop", {});
  const seq = view().seq;
  advance(10_000);
  assert.equal(view().seq, seq);
  assert.ok(view().entities.every((e) => e.kind !== "reply" || !e.streaming));
});

test("takeover and hand back: needs_you → paused → working → completed", async () => {
  const { host, advance, view } = await setup();
  const status = () => view().entities.flatMap((e) => (e.kind === "browser" && e.id === "b-seed3" ? [e.status] : []))[0];
  assert.equal(status(), "needs_you");
  await host.call("browser.control", { id: "b-seed3", action: "take" });
  assert.equal(status(), "paused");
  await host.call("browser.control", { id: "b-seed3", action: "handBack" });
  assert.equal(status(), "working");
  assert.deepEqual(view().activity, { kind: "working", label: "Re-observing page" });
  advance(10_000);
  assert.equal(status(), "completed");
});

test("an illegal command rejects and records nothing", async () => {
  const { host, view } = await setup();
  const seq = view().seq;
  await assert.rejects(host.call("browser.control", { id: "b-seed1", action: "handBack" }), Rejected);
  assert.equal(view().seq, seq);
});

test("connecting returns the hosted link, then the callback marks it connected", async () => {
  const { host, advance, view } = await setup();
  const { url } = await host.call("connection.begin", { id: "c-seed1" });
  assert.match(url, /^https:\/\//);
  advance(1000);
  assert.ok(view().entities.some((e) => e.kind === "connection" && e.id === "c-seed1" && e.status === "connected"));
});

test("the agent acts through the rules: a URL in the prompt starts a browser run that finishes", async () => {
  const { host, advance, view } = await setup();
  await host.call("chat.send", { text: "check https://tides.example/today" });
  const run = () => view().entities.find((e) => e.kind === "browser" && e.url === "https://tides.example/today");
  assert.ok(run(), "the browser run started");
  advance(10_000);
  const done = run();
  assert.ok(done?.kind === "browser" && done.status === "completed");
});

test("an agent's ask becomes a pending approval; resolving it answers the waiting agent", async () => {
  const { timers } = manualTimers();
  let io: AgentIO | undefined;
  const ports = {
    ...demoPorts(timers),
    prompt: (_: string, agent: AgentIO) => {
      io = agent;
    },
  };
  const host = createHost(ports, { clock });
  await host.call("chat.send", { text: "book it" });
  assert.ok(io);
  const asked = io.act({ kind: "ask", action: "Submit", target: "opentable.com", detail: "Book a table for 4" });
  assert.ok(asked.ok);
  const verdict = io.decision(asked.id);
  await host.call("approval.resolve", { id: asked.id, resolution: "deny" });
  assert.equal(await verdict, "denied");
});
