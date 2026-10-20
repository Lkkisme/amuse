import assert from "node:assert/strict";
import { test } from "node:test";
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
