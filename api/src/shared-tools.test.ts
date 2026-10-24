import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type Ports, createHost, memoryRules, noKeys, noLogins, noSandbox, noSecrets } from "@amuse/core";
import type { Apps } from "@amuse/pi";
import { createBrowserMcp, type BrowserMcp, type BrowserMcpActions } from "./browser-mcp.ts";
import { sharedAmuseTools, type ToolContext } from "./shared-tools.ts";
import { workspace } from "./workspace.ts";
import { memorySent } from "./sent.ts";

async function setup(t: TestContext, apps?: Apps) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-shared-tools-"));
  t.after(() => { assert.equal(dirname(dir), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); });
  const files = workspace(join(dir, "workspace"), memorySent(), dir);
  const rules = memoryRules();
  const ports: Ports = { files, rules, keys: noKeys, logins: noLogins, sandbox: noSandbox, secrets: noSecrets,
    prompt: () => {}, interrupt: () => {}, title: async () => "", browse: () => {}, job: () => {}, task: () => {}, schedule: () => {}, browser: () => {}, approval: () => {}, stopTask: () => {}, fit: () => {}, connect: async () => "",
    apps: { access: async () => ({ kind: "managed" }), cannotConnect: async () => null, connectKey: async () => { throw new Error("No key connection in this fixture."); }, search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "", disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
  };
  const host = createHost(ports, { clock: { now: () => "2026-10-21T08:00:00Z" }, timers: { set: () => 0, clear: () => {} } });
  const other = await host.call("chats.create", {});
  const quiet: string[] = [];
  const actors = new Map<string, ToolContext>();
  const actorStops = new Map<string, AbortController>();
  let unanswered = true;
  const context = (scope: string) => actors.get(scope) ?? ({ io: host.agent(scope), unanswered: () => unanswered, quiet: () => { quiet.push(scope); } });
  const api = sharedAmuseTools({ host: () => host, context,
    config: { files, rules, ...(apps ? { apps } : {}), skills: [{ name: "fixture", description: "Read the integration fixture", body: "Keep the fixture intact.", from: "built in" }] }, directory: join(dir, "codemode") });
  let mcp: BrowserMcp;
  const http = createServer((req, res) => { void mcp.handle(req, res).catch(() => { res.statusCode = 500; res.end(); }); });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); assert.ok(address && typeof address === "object");
  const actions: BrowserMcpActions = { open: async () => ({ id: "unused" }), list: async () => [], observe: async () => ({}), act: async () => ({}), screenshot: async () => new Uint8Array(), finish: async () => {} };
  mcp = createBrowserMcp({ actions, url: `http://127.0.0.1:${address.port}`, tokenPath: join(dir, "tokens.json"), tools: api.tools });
  const clients: Client[] = [];
  async function connect(scope: string) {
    const cfg = mcp.config(scope).amuse_browser;
    const client = new Client({ name: "shared-tools-test", version: "1" }); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }) as Transport);
    return client;
  }
  t.after(async () => { await Promise.all(clients.map((client) => client.close())); await mcp.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  const actor = () => {
    const io = host.agent("main"); const made = io.act({ kind: "task", title: "Actor fixture", instructions: "Work on a fixture" }); assert.ok(made.ok);
    const scope = `main~${made.id}`;
    const stop = new AbortController(); actorStops.set(scope, stop);
    actors.set(scope, { io, unanswered: () => false, quiet: () => {}, run: { id: made.id, title: "Actor fixture", noun: "task", kind: "task", io, stop: stop.signal, report: async () => {} } });
    return scope;
  };
  return { dir, files, rules, host, api, context, other: other.id, main: await connect("main"), connect, quiet, actor, stopActor: (scope: string) => actorStops.get(scope)!.abort(), answer: () => { unanswered = false; } };
}
const content = (result: unknown) => JSON.stringify(result);

test("shared HTTP MCP retains schemas and reaches the actual memory, skills and goal stores", async (t) => {
  const { main, files, host } = await setup(t);
  const { tools } = await main.listTools();
  const remember = tools.find((tool) => tool.name === "remember"); assert.ok(remember);
  assert.ok(remember.inputSchema.required?.includes("section"));
  const invalid = await main.callTool({ name: "remember", arguments: { section: "invalid", text: "must not write", source: "fixture" } });
  assert.equal(invalid.isError, true);
  assert.equal(await files.exists("memory/MEMORY.md"), false);
  const remembered = await main.callTool({ name: "remember", arguments: { status: "记住偏好", section: "Preferences", text: "Keep model and 256K", source: "the user explicitly asked" } });
  assert.notEqual(remembered.isError, true);
  assert.match(new TextDecoder().decode((await files.open("memory/MEMORY.md")).data), /Keep model and 256K/);
  assert.match(content(await main.callTool({ name: "use_skill", arguments: { status: "阅读技能", name: "fixture" } })), /Keep the fixture intact/);
  const added = await main.callTool({ name: "goals_add", arguments: { title: "Integration fixture", about: "Keep history intact." } });
  assert.notEqual(added.isError, true);
  const { goals } = await host.call("goals.list", {}); assert.equal(goals.length, 1);
  assert.match(content(await main.callTool({ name: "amuse_context", arguments: {} })), /Keep model and 256K/);
  const updated = await main.callTool({ name: "goals_update", arguments: { id: goals[0]!.id, muted: true } }); assert.notEqual(updated.isError, true);
  assert.equal((await host.call("goals.get", { id: goals[0]!.id })).goal.muted, true);
});

test("codemode persists per-chat stores, validates nested calls, and exposes no Node or network globals", async (t) => {
  const { main, other, connect, host, actor } = await setup(t);
  const code = (client: Client, source: string) => client.callTool({ name: "codemode", arguments: { code: source } });
  assert.match(content(await code(main, 'store("marker", "alpha"); text(typeof process); text(typeof require); text(typeof fetch);')), /undefined/);
  assert.match(content(await code(main, 'text(load("marker"));')), /alpha/);
  const side = await connect(other);
  assert.doesNotMatch(content(await code(side, 'text(load("marker") ?? "no marker");')), /alpha/);
  assert.match(content(await code(main, 'const all = await tools.goals_list({}); text(all);')), /goals/);
  const invalid = await code(main, 'await tools.goals_add({title:"missing required about"});');
  assert.match(content(invalid), /Script failed/);
  assert.equal((await host.call("goals.list", {})).goals.length, 0);
  await Promise.all([code(main, 'store("one", 1);'), code(main, 'store("two", 2);')]);
  assert.match(content(await code(main, 'text([load("one"),load("two")]);')), /1,2/);
  const helper = await connect(actor());
  assert.doesNotMatch(content(await code(helper, 'text(load("marker") ?? "no marker");')), /alpha/);
  await code(helper, 'store("actorOnly", "helper-private");');
  const secondHelper = await connect(actor());
  assert.doesNotMatch(content(await code(secondHelper, 'text(load("actorOnly") ?? "no actor store");')), /helper-private/);
});

test("shared no_reply cannot silence an unanswered user message", async (t) => {
  const { main, quiet, answer } = await setup(t);
  assert.match(content(await main.callTool({ name: "no_reply", arguments: {} })), /user wrote/);
  assert.deepEqual(quiet, []);
  answer();
  assert.match(content(await main.callTool({ name: "no_reply", arguments: {} })), /Nothing is shown/);
  assert.deepEqual(quiet, ["main"]);
});

test("shared HTTP say publishes immediately to its own chat without ending the native turn or bypassing helper reporting", async (t) => {
  const f = await setup(t);
  const { tools } = await f.main.listTools();
  assert.ok(tools.some((tool) => tool.name === "say"));
  assert.ok(tools.some((tool) => tool.name === "list_schedules"));
  f.host.external.ingest("main", [{ kind: "activity", activity: { kind: "working", label: "Native task is running" } }]);
  const empty = await f.main.callTool({ name: "say", arguments: { text: "  " } });
  assert.match(content(empty), /empty/);
  assert.equal(f.host.external.state("main").entities.filter((entity) => entity.kind === "reply").length, 0);
  assert.notEqual((await f.main.callTool({ name: "say", arguments: { text: "正在核对，程序继续运行。" } })).isError, true);
  let replies = f.host.external.state("main").entities.filter((entity) => entity.kind === "reply");
  assert.equal(replies.length, 1, "progress appears before a native final reply exists");
  assert.equal(replies[0]?.text, "正在核对，程序继续运行。");
  assert.equal(f.host.external.state("main").activity?.label, "Native task is running");
  assert.match(content(await f.main.callTool({ name: "no_reply", arguments: {} })), /user wrote/, "say does not permit dropping an unanswered user request");
  const side = await f.connect(f.other);
  await side.callTool({ name: "say", arguments: { text: "Side-chat progress" } });
  assert.equal(f.host.external.state("main").entities.filter((entity) => entity.kind === "reply").length, 1);
  assert.equal(f.host.external.state(f.other).entities.filter((entity) => entity.kind === "reply").length, 1);
  const helper = await f.connect(f.actor());
  assert.equal((await helper.listTools()).tools.some((tool) => tool.name === "say"), false, "background helpers retain report and muted-goal boundaries");
  f.host.external.ingest("main", [{ kind: "upserted", entity: { kind: "reply", id: "native-final", at: "2026-10-21T08:01:00Z", text: "核对完成。", streaming: false, attachments: [] } }]);
  await f.host.call("session.sync", { chat: "main", since: null });
  await f.host.call("session.sync", { chat: "main", since: null });
  replies = f.host.external.state("main").entities.filter((entity) => entity.kind === "reply");
  assert.deepEqual(replies.map((reply) => reply.text), ["正在核对，程序继续运行。", "核对完成。"]);
});

test("shared HTTP list_schedules uses complete live ids across chats so cancellation reaches the intended schedule", async (t) => {
  const f = await setup(t);
  await f.main.callTool({ name: "schedule", arguments: { status: "设置计划", title: "Main reminder", instructions: "Fixture reminder", at: "2027-01-01 08:00", timezone: "UTC" } });
  const mainSchedule = (await f.host.call("schedules.list", {})).schedules[0]!;
  const sideSchedule = f.host.agent(f.other).act({ kind: "schedule", title: "Side reminder", instructions: "Fixture paused reminder", when: { kind: "repeat", cron: "0 8 * * *", timezone: "UTC" }, needs: null });
  assert.ok(sideSchedule.ok);
  await f.host.call("schedule.control", { id: sideSchedule.id, action: "pause" });
  const cancelled = f.host.agent("main").act({ kind: "schedule", title: "Cancelled fixture", instructions: "Never run", when: { kind: "once", at: "2027-01-01T09:00:00Z" }, needs: null });
  assert.ok(cancelled.ok);
  await f.host.call("schedule.control", { id: cancelled.id, action: "cancel" });
  const listed = content(await f.main.callTool({ name: "list_schedules", arguments: { status: "查看计划" } }));
  assert.ok(listed.includes(mainSchedule.id), "the full id from the real core is retained");
  assert.ok(listed.includes(sideSchedule.id), "paused schedules in another chat remain discoverable");
  assert.match(listed, /Side reminder.*paused/);
  assert.equal(listed.includes(cancelled.id), false);
  const result = await f.main.callTool({ name: "cancel_schedule", arguments: { status: "取消计划", id: sideSchedule.id } });
  assert.ok(content(result).includes(`Cancelled ${sideSchedule.id}`));
  const remaining = content(await f.main.callTool({ name: "list_schedules", arguments: { status: "核对计划" } }));
  assert.ok(remaining.includes(mainSchedule.id));
  assert.equal(remaining.includes(sideSchedule.id), false);
});

test("HTTP app tools preserve nested action arguments and still enforce a deny rule", async (t) => {
  let permission: "deny" | "allow" = "deny"; const calls: unknown[] = [];
  const apps: Apps = { accounts: async () => [{ id: "account", label: "fixture@example.test" }], tools: async () => [], permission: async () => permission, kind: async () => "write", remember: async () => {}, call: async (_slug, args) => { calls.push(args); return { ok: true, data: "fixture done" }; } };
  const f = await setup(t, apps);
  const arguments_ = { to: "fixture@example.test", body: { text: "你好", values: [1, false, null] }, optional: "kept" };
  const invoke = () => f.main.callTool({ name: "app_call", arguments: { status: "执行合成检查", action: "GMAIL_SEND_EMAIL", arguments: arguments_, summary: "Send synthetic fixture", reason: "test fixture only" } });
  assert.match(content(await invoke()), /Refused by your rule/);
  assert.deepEqual(calls, []);
  assert.equal((await f.host.call("approvals.list", {})).approvals[0]?.approval.byRule, true);
  permission = "allow";
  assert.match(content(await invoke()), /fixture done/);
  assert.deepEqual(calls, [arguments_]);
});

test("approving an old helper card after that helper was stopped never runs its app action", async (t) => {
  const f = await setup(t); const scope = f.actor(); const performed: string[] = [];
  const apps: Apps = { accounts: async () => [{ id: "account", label: "fixture@example.test" }], tools: async () => [], permission: async () => "ask", kind: async () => "write", remember: async () => {}, call: async () => { performed.push("write"); return { ok: true, data: "wrote" }; } };
  const tools = sharedAmuseTools({ host: () => f.host, context: f.context, config: { files: f.files, rules: f.rules, apps }, directory: join(f.dir, "cancel-test") });
  const tool = tools.tools(scope).find((entry) => entry.name === "app_call")!;
  const pending = tool.execute("pending-write", { status: "等待确认", action: "GMAIL_SEND_EMAIL", arguments: { to: "fixture@example.test" }, summary: "Send fixture email", reason: "the test user asked" }, new AbortController().signal).then(() => "finished", (error: unknown) => error);
  let approvalId = "";
  for (let n = 0; n < 100 && !approvalId; n++) { approvalId = (await f.host.call("approvals.list", {})).approvals[0]?.approval.id ?? ""; await new Promise<void>((resolve) => setImmediate(resolve)); }
  assert.ok(approvalId);
  f.stopActor(scope); await new Promise<void>((resolve) => setImmediate(resolve));
  await f.host.call("approval.resolve", { id: approvalId, resolution: "allow_once" });
  assert.notEqual(await pending, "finished", "the aborted tool settles as cancelled");
  assert.deepEqual(performed, [], "a stopped helper must not carry out an approved-but-stale external action");
});

test("a foreground app approval intentionally survives the completed MCP request", async (t) => {
  const f = await setup(t); const performed: string[] = [];
  const apps: Apps = { accounts: async () => [{ id: "account", label: "fixture@example.test" }], tools: async () => [], permission: async () => "ask", kind: async () => "write", remember: async () => {}, call: async () => { performed.push("write"); return { ok: true, data: "wrote" }; } };
  const tools = sharedAmuseTools({ host: () => f.host, context: f.context, config: { files: f.files, rules: f.rules, apps }, directory: join(f.dir, "foreground-test") });
  const tool = tools.tools("main").find((entry) => entry.name === "app_call")!;
  const signal = new AbortController();
  const result = await tool.execute("foreground-write", { status: "等待确认", action: "GMAIL_SEND_EMAIL", arguments: { to: "fixture@example.test" }, summary: "Send fixture email", reason: "the test user asked" }, signal.signal);
  assert.match(content(result), /NOT done yet/);
  signal.abort(); // stateless MCP request has completed; the approval is detached by design.
  const approval = (await f.host.call("approvals.list", {})).approvals[0]!;
  await f.host.call("approval.resolve", { id: approval.approval.id, resolution: "allow_once" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(performed, ["write"]);
});
