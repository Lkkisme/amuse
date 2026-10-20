import assert from "node:assert/strict";
import { test } from "node:test";
import { type Session, type State, apply, prepend } from "@remuse/protocol";
import { type AgentIO, type Ports, createHost } from "./index.ts";

/** Ports that do nothing but hand over the AgentIO, so tests can act like an agent. */
function capture() {
  let io: AgentIO | undefined;
  const ports: Ports = {
    prompt: (_, agent) => void (io = agent),
    interrupt: () => {},
    browse: () => {},
    browser: () => {},
    approval: () => {},
    stopTask: () => {},
    connect: async () => "https://connect.example/",
  };
  return { ports, io: () => io };
}

test("a decision already made is answered at once; one still open waits for the user", async () => {
  const { ports, io } = capture();
  const host = createHost(ports);
  await host.call("chat.send", { text: "go" });
  const agent = io();
  assert.ok(agent);
  const asked = agent.act({ kind: "ask", action: "send", target: "gmail", detail: "{}" });
  assert.ok(asked.ok);
  const early = agent.decision(asked.id);
  await host.call("approval.resolve", { id: asked.id, resolution: "allow_once" });
  assert.equal(await early, "approved");
  assert.equal(await agent.decision(asked.id), "approved"); // asked again after the fact
});

test("an agent cannot move a run the user stopped", async () => {
  const { ports, io } = capture();
  const host = createHost(ports);
  await host.call("chat.send", { text: "go" });
  const agent = io();
  assert.ok(agent);
  const started = agent.act({ kind: "browse", title: "t", url: "https://x.example/" });
  assert.ok(started.ok);
  await host.call("browser.control", { id: started.id, action: "stop" });
  assert.deepEqual(agent.act({ kind: "browserStatus", id: started.id, status: "completed" }), {
    ok: false,
    rejection: { kind: "invalid", action: "browserStatus", from: "stopped" },
  });
});

test("a client holding only the recent end sees what the whole feed shows there, and pages back to all of it", async () => {
  const { ports, io } = capture();
  const host = createHost(ports, { snapshot: 3 });
  for (const text of ["a", "b", "c", "d", "e"]) await host.call("chat.send", { text });
  const agent = io();
  assert.ok(agent);
  const run = agent.act({ kind: "browse", title: "t", url: "https://x.example/" });
  assert.ok(run.ok);
  for (const text of ["f", "g", "h", "i"]) await host.call("chat.send", { text });

  const synced = await host.call("session.sync", { since: null });
  assert.ok(synced.kind === "snapshot");
  let client = synced.state;
  assert.equal(client.earlier, 5); // reaches back to the run still in play
  host.subscribe((u) => (client = u.kind === "event" ? apply(client, u.envelope) : u.state));

  agent.act({ kind: "browserStatus", id: run.id, status: "completed" });
  await host.call("chat.send", { text: "j" });
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
