import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopTools, terminateDesktopProcessTree, type DesktopTools } from "./desktop.ts";

// An SDK-based stdio fixture, with no dependency on Windows or the real desktop.
const server = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
const server = new Server({ name: "desktop-fixture", version: "1" }, { capabilities: { tools: {} } });
const tool = name => ({ name, description: "Fixture " + name, inputSchema: { type: "object", properties: { ms: { type: "number" } }, additionalProperties: false } });
server.setRequestHandler(ListToolsRequestSchema, async request => request.params?.cursor
  ? { tools: [tool("Fail"), tool("ProtocolError")] }
  : { tools: [tool("Inspect"), tool("Delay"), tool("DetachedChild")], nextCursor: "page-two" });
let active = 0, calls = 0, maxActive = 0;
server.setRequestHandler(CallToolRequestSchema, async request => {
  calls++;
  active++;
  maxActive = Math.max(maxActive, active);
  try {
    if (request.params.name === "DetachedChild") {
      const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      child.unref();
      return { content: [{ type: "text", text: String(child.pid) }] };
    }
    if (request.params.name === "ProtocolError") throw new McpError(ErrorCode.InvalidParams, "fixture protocol error");
    if (request.params.name === "Fail") return { content: [{ type: "text", text: "fixture tool failure" }], isError: true };
    if (request.params.name === "Delay") await new Promise(resolve => setTimeout(resolve, request.params.arguments?.ms ?? 20));
    return { content: [
      { type: "text", text: JSON.stringify({ calls, maxActive }) },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }
    ], structuredContent: { calls, maxActive } };
  } finally { active--; }
});
await server.connect(new StdioServerTransport());
`;

async function fixture(): Promise<DesktopTools> {
  return createDesktopTools({ command: process.execPath, args: ["--input-type=module", "--eval", server] });
}

function call(bridge: DesktopTools, name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
  const tool = bridge.tools.find((tool) => tool.name === "desktop_call");
  assert.ok(tool);
  // These tools do not use the Pi session context.
  return tool.execute("fixture-call", { name, args }, signal, undefined, {} as never);
}

test("desktop discovery returns all pages and the server's exact input schemas", async (t) => {
  const bridge = await fixture();
  t.after(() => bridge.close());
  const tool = bridge.tools.find((tool) => tool.name === "desktop_tools");
  assert.ok(tool);
  const result = await tool.execute("fixture-list", {}, undefined, undefined, {} as never);
  assert.equal(result.content[0]?.type, "text");
  const data = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "");
  assert.deepEqual(data.tools.map((tool: { name: string }) => tool.name), ["Inspect", "Delay", "DetachedChild", "Fail", "ProtocolError"]);
  assert.deepEqual(data.tools[0].inputSchema, { type: "object", properties: { ms: { type: "number" } }, additionalProperties: false });
  // Discovery must not execute any desktop tool.
  const observed = await call(bridge, "Inspect");
  assert.deepEqual((observed.details as { mcp: { structuredContent: unknown } }).mcp.structuredContent, { calls: 1, maxActive: 1 });
});

test("desktop results preserve text, image data, structured output and remote error status", async (t) => {
  const bridge = await fixture();
  t.after(() => bridge.close());
  const result = await call(bridge, "Inspect");
  assert.deepEqual(result.content, [
    { type: "text", text: '{"calls":1,"maxActive":1}' },
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  ]);
  assert.equal(result.isError, false);
  const failure = await call(bridge, "Fail");
  assert.equal(failure.isError, true);
  assert.deepEqual(failure.content, [{ type: "text", text: "fixture tool failure" }]);
  // A tool-reported failure is not a broken transport.
  assert.equal((await call(bridge, "Inspect")).isError, false);
});

test("desktop calls from different agents are serialized and unknown names never run", async (t) => {
  const bridge = await fixture();
  t.after(() => bridge.close());
  await assert.rejects(call(bridge, "Invented"), /Unknown desktop tool/);
  const results = await Promise.all([call(bridge, "Delay", { ms: 50 }), call(bridge, "Delay", { ms: 20 }), call(bridge, "Inspect")]);
  for (const result of results)
    assert.equal((result.details as { mcp: { structuredContent: { maxActive: number } } }).mcp.structuredContent.maxActive, 1);
});

test("cancelling a queued desktop call does not send it or interrupt the active call", async (t) => {
  const bridge = await fixture();
  t.after(() => bridge.close());
  const running = call(bridge, "Delay", { ms: 100 });
  const abort = new AbortController();
  const waiting = call(bridge, "Inspect", {}, abort.signal);
  abort.abort(new Error("queued cancellation"));
  await assert.rejects(waiting, /queued cancellation/);
  await running;
  const result = await call(bridge, "Inspect");
  assert.deepEqual((result.details as { mcp: { structuredContent: unknown } }).mcp.structuredContent, { calls: 2, maxActive: 1 });
});

test("cancelling an active call closes the child before another call can run", async (t) => {
  const bridge = await fixture();
  t.after(() => bridge.close());
  const abort = new AbortController();
  const running = call(bridge, "Delay", { ms: 10_000 }, abort.signal);
  await new Promise((resolve) => setTimeout(resolve, 80));
  abort.abort(new Error("active cancellation"));
  await assert.rejects(running, /active cancellation/);
  await assert.rejects(call(bridge, "Inspect"), /connection is closed/);
});

test("protocol errors retain their message and close is idempotent", async () => {
  const bridge = await fixture();
  try {
    await assert.rejects(call(bridge, "ProtocolError"), /fixture protocol error/);
    await assert.rejects(call(bridge, "Inspect"), /connection is closed/);
  } finally {
    await Promise.all([bridge.close(), bridge.close()]);
  }
});

test("Windows tree termination uses only the current transport PID and tolerates a confirmed exit race", async () => {
  let pid: number | null = 23456;
  const transport = { get pid() { return pid; } };
  const seen: number[] = [];
  const runtime = {
    platform: "win32",
    async terminate(owned: number) { seen.push(owned); },
    alive() { return true; },
  };
  await terminateDesktopProcessTree(transport, runtime);
  assert.deepEqual(seen, [23456]);
  pid = null;
  await terminateDesktopProcessTree(transport, runtime);
  await terminateDesktopProcessTree({ pid: 23456 }, { ...runtime, platform: "linux" });
  assert.deepEqual(seen, [23456]);
  await assert.rejects(terminateDesktopProcessTree({ pid: -1 }, runtime), /valid process ID/);
  // A nonzero taskkill exit is harmless only if the owned process is gone.
  const failure = new Error("taskkill failed");
  await terminateDesktopProcessTree({ pid: 23456 }, { ...runtime, async terminate() { throw failure; }, alive() { return false; } });
  pid = 23456;
  await terminateDesktopProcessTree(transport, { ...runtime, async terminate() { pid = null; throw failure; }, alive() { throw new Error("must not inspect a released PID"); } });
  await assert.rejects(terminateDesktopProcessTree({ pid: 23456 }, { ...runtime, async terminate() { throw failure; } }), (error) => error === failure);
  await assert.rejects(terminateDesktopProcessTree({ pid: 23456 }, { ...runtime, async terminate() { throw failure; }, alive() { throw new Error("access denied"); } }), (error) => error === failure);
});

test("Windows cancellation also stops a detached descendant of the MCP child", { skip: process.platform !== "win32" }, async (t) => {
  const bridge = await fixture();
  let descendant: number | undefined;
  t.after(async () => {
    await bridge.close();
    if (descendant !== undefined) {
      try { process.kill(descendant); } catch { /* already stopped */ }
    }
  });
  const spawned = await call(bridge, "DetachedChild");
  assert.equal(spawned.content[0]?.type, "text");
  descendant = Number(spawned.content[0]?.type === "text" ? spawned.content[0].text : "");
  assert.ok(Number.isInteger(descendant) && descendant > 0);
  process.kill(descendant, 0);
  const abort = new AbortController();
  const running = call(bridge, "Delay", { ms: 10_000 }, abort.signal);
  await new Promise((resolve) => setTimeout(resolve, 80));
  abort.abort(new Error("cancel detached fixture"));
  // Rejection waits for the complete process tree to be terminated.
  await assert.rejects(running, /cancel detached fixture/);
  assert.throws(() => process.kill(descendant!, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH");
});
