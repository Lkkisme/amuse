import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { type AgentIO, type Ports, createHost, memoryChats, memoryRules, noKeys, noWorkspace, noLogins, noSandbox } from "@amuse/core";
import type { Session, Task } from "@amuse/protocol";
import type { FileStore } from "./workspace.ts";
import { type BridgeAgent, type BridgeClient, type BridgeEntry, type PaseoBridgeOptions, paseoBridge } from "./paseo.ts";
import type { PaseoCreateOptions } from "./paseo-client.ts";

const at = "2026-10-21T12:00:00.000Z";
const agent = (id: string, status = "idle", provider = "qwen-multi"): BridgeAgent => ({ id, status, provider, title: `Chat ${id}`, createdAt: at, updatedAt: at });

class FakeClient implements BridgeClient {
  agents = new Map<string, BridgeAgent>();
  entries = new Map<string, BridgeEntry[]>();
  listeners = new Set<(event: Record<string, unknown>) => void>();
  sends: { id: string; text: string; clientMessageId?: string }[] = [];
  cancels: string[] = [];
  watched: string[] = [];
  created = 0;
  createCalls: { title: string | undefined; cwd: string | undefined; options: PaseoCreateOptions | undefined }[] = [];
  closed = false;
  announceCreated = false;
  announceWatched = false;
  failSend: "before" | "after" | "busy" | "unknown" | null = null;
  rejectedBusyIds = new Set<string>();
  async listAgents() { return [...this.agents.values()].map((value) => structuredClone(value)); }
  async createAgent(title?: string, cwd?: string, options?: PaseoCreateOptions) {
    this.createCalls.push({ title, cwd, options: structuredClone(options) });
    const created = { ...agent(`created-${++this.created}`), title: title ?? "New", cwd };
    this.agents.set(created.id, created);
    if (this.announceCreated) for (const listener of this.listeners) listener({ type: "agent_update", agentId: created.id, payload: { kind: "upsert", agent: structuredClone(created) } });
    return structuredClone(created);
  }
  async history(id: string, options?: { after?: { epoch: string; seq: number } }) {
    const all = this.entries.get(id) ?? [];
    return {
      agent: structuredClone(this.agents.get(id) ?? null),
      entries: structuredClone(all.filter((entry) => entry.seqEnd > (options?.after?.seq ?? 0))),
      epoch: "fake-epoch", endCursor: { epoch: "fake-epoch", seq: all.at(-1)?.seqEnd ?? 0 },
    };
  }
  async watch(id: string) {
    this.watched.push(id);
    const current = this.agents.get(id);
    if (this.announceWatched && current) for (const listener of this.listeners) listener({ type: "agent_update", agentId: id, payload: { kind: "upsert", agent: structuredClone(current) } });
  }
  subscribe(listener: (event: Record<string, unknown>) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async send(id: string, text: string, options?: { clientMessageId?: string }) {
    this.sends.push({ id, text, ...options });
    const fail = this.failSend;
    this.failSend = null;
    if (options?.clientMessageId && this.rejectedBusyIds.has(options.clientMessageId)) throw new Error("agent_request_outcome_unknown");
    if (fail === "before") throw new Error("mock transport rejected before receipt");
    if (fail === "unknown") throw new Error("agent_request_outcome_unknown");
    if (fail === "busy") { if (options?.clientMessageId) this.rejectedBusyIds.add(options.clientMessageId); throw new Error("The local Qwen worker is busy. Another native team owns its lease."); }
    const existing = this.entries.get(id) ?? [];
    const seq = (existing.at(-1)?.seqEnd ?? 0) + 1;
    this.entries.set(id, [...existing, { seqStart: seq, seqEnd: seq, timestamp: at, item: { type: "user_message", text, messageId: `message-${seq}`, clientMessageId: options?.clientMessageId } }]);
    if (fail === "after") throw new Error("mock transport disconnected after receipt");
  }
  async cancel(id: string) { this.cancels.push(id); }
  async rename(id: string, title: string) { const current = this.agents.get(id); if (current) this.agents.set(id, { ...current, title }); }
  async respondPermission() {}
  close() { this.closed = true; }
}

function ports(): Ports {
  return {
    prompt: () => { throw new Error("bridge must never invoke the Pi agent"); },
    interrupt: () => {}, title: async () => "unused", browse: () => {}, job: () => {}, task: () => {}, schedule: () => {},
    browser: () => {}, approval: () => {}, stopTask: () => {}, fit: () => {}, connect: async () => "https://example.invalid/",
    apps: { search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "https://example.invalid/", disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
    rules: memoryRules(), keys: noKeys, files: noWorkspace, logins: noLogins, sandbox: noSandbox,
  };
}

async function setup(t: TestContext, client = new FakeClient(), browser: Partial<PaseoBridgeOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-paseo-test-"));
  const path = join(dir, "bridge.json");
  const store = memoryChats();
  const host = createHost(ports(), { store });
  const options: PaseoBridgeOptions = {
    path, cwd: "D:\\LocalAI\\Amuse", workspaceRoot: dir, model: "same-qwen", contextWindow: 262144,
    files: { ...noWorkspace, save: async () => null, find: () => null, serve: async () => null } satisfies FileStore,
    ...browser,
  };
  const bridge = paseoBridge(client, options);
  const session = await bridge.attach(host);
  const bridges = [bridge];
  t.after(() => {
    for (const instance of bridges) instance.close();
    rmSync(path, { force: true }); rmSync(`${path}.next`, { force: true }); rmdirSync(dir);
  });
  return { bridge, bridges, client, host, store, session, options, path };
}

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));
async function mirrored(session: Session, title: string) {
  const chat = (await session.call("chats.list", {})).chats.find((entry) => entry.title === title);
  assert.ok(chat, `missing mirrored chat ${title}`);
  return chat.id;
}

test("an explicit worker-busy refusal retains a durable queued message and retries only after the lease backoff", async (t) => {
  let now = Date.parse(at);
  t.mock.method(Date, "now", () => now);
  const client = new FakeClient(); client.failSend = "busy";
  const f = await setup(t, client, { browserInstructions: () => "Same browser, model and context." });
  await f.session.call("chat.send", { chat: "main", text: "Wait for the existing team", timezone: "UTC", attachments: [] });
  await settled();
  let saved = JSON.parse(readFileSync(f.path, "utf8")) as { queue: { id: string; state: string; retryAfter: number }[] };
  assert.equal(saved.queue.length, 1);
  assert.equal(saved.queue[0]?.state, "queued", "an explicit pre-start lease refusal is safe to retry");
  assert.equal(saved.queue[0]?.retryAfter, now + 15_000);
  assert.equal(f.host.external.state("main").entities.some((entity) => entity.kind === "failure"), false);
  assert.equal(client.entries.get("created-1"), undefined, "no native receipt exists for the refused attempt");
  await f.session.call("session.sync", { chat: "main", since: null }); await settled();
  assert.equal(client.sends.length, 1, "refresh must not immediately retry a busy worker");
  const messageId = saved.queue[0]!.id;
  now += 15_001;
  await f.session.call("session.sync", { chat: "main", since: null }); await settled();
  assert.equal(client.sends.length, 2);
  assert.notEqual(client.sends[1]?.clientMessageId, client.sends[0]?.clientMessageId, "Paseo caches a refused request id; a proven pre-start refusal needs a fresh delivery id");
  assert.ok(client.sends[1]?.clientMessageId);
  assert.equal(client.sends[0]?.text, client.sends[1]?.text, "the one-time capability notice stays with the queued delivery");
  saved = JSON.parse(readFileSync(f.path, "utf8")) as typeof saved;
  assert.equal(saved.queue.length, 0);
  assert.deepEqual(client.cancels, []);
  assert.equal(client.created, 1, "reuse the existing native session instead of creating or restarting one");
  await f.session.call("session.sync", { chat: "main", since: null });
  let prompts = f.host.external.state("main").entities.filter((entity) => entity.kind === "prompt");
  assert.equal(prompts.length, 1, "a fresh native delivery receipt still acknowledges the existing phone prompt");
  assert.equal(prompts[0]?.id, messageId);
  assert.equal(prompts[0]?.text, "Wait for the existing team");
  f.bridge.close();
  const host = createHost(ports(), { store: f.store });
  const restarted = paseoBridge(client, f.options); f.bridges.push(restarted);
  const session = await restarted.attach(host); await session.call("session.sync", { chat: "main", since: null });
  prompts = host.external.state("main").entities.filter((entity) => entity.kind === "prompt");
  assert.equal(prompts.length, 1, "delivery aliases must survive restart and a full history replay");
  assert.equal(prompts[0]?.id, messageId);
});

test("an unknown send outcome without an explicit busy refusal is never automatically retried", async (t) => {
  let now = Date.parse(at); t.mock.method(Date, "now", () => now);
  const client = new FakeClient(); client.failSend = "unknown";
  const f = await setup(t, client);
  await f.session.call("chat.send", { chat: "main", text: "Do this only once", timezone: "UTC", attachments: [] }); await settled();
  const saved = JSON.parse(readFileSync(f.path, "utf8")) as { queue: { state: string }[] };
  assert.equal(saved.queue[0]?.state, "sending");
  now += 300_000;
  await f.session.call("session.sync", { chat: "main", since: null }); await settled();
  assert.equal(client.sends.length, 1, "lack of a receipt is not proof that an uncertain request was refused");
  assert.deepEqual(client.cancels, []);
});

test("a restored queued message waits for the shared tool endpoint to be ready before activation", async (t) => {
  let ready = false; let prepared = 0;
  const f = await setup(t, new FakeClient(), { ready: () => ready, prepare: async () => { prepared++; return "Ready shared memory and skills"; } });
  await f.session.call("chat.send", { chat: "main", text: "Retain this queued instruction", timezone: "UTC", attachments: [] }); await settled();
  assert.equal(f.client.sends.length, 0); assert.equal(prepared, 0);
  f.bridge.close();
  const host = createHost(ports(), { store: f.store });
  const restarted = paseoBridge(f.client, f.options); f.bridges.push(restarted);
  const session = await restarted.attach(host);
  await session.call("session.sync", { chat: "main", since: null }); restarted.activate(); await settled();
  assert.equal(f.client.sends.length, 0, "restored queues and explicit activate both respect service readiness");
  ready = true; restarted.activate(); await settled();
  assert.equal(f.client.sends.length, 1);
  assert.match(f.client.sends[0]!.text, /Ready shared memory and skills/);
  assert.match(f.client.sends[0]!.text, /Retain this queued instruction/);
  assert.equal(prepared, 1);
  restarted.activate(); await settled(); assert.equal(f.client.sends.length, 1);
  assert.equal(f.client.created, 1); assert.deepEqual(f.client.cancels, []);
});

test("Paseo bridge imports Qwen chats, retains stable history across refreshes, and preserves model status", async (t) => {
  const client = new FakeClient();
  client.agents.set("existing", agent("existing"));
  client.agents.set("foreign", agent("foreign", "idle", "unrelated-provider"));
  client.entries.set("existing", [
    { seqStart: 1, seqEnd: 1, timestamp: at, item: { type: "user_message", messageId: "u1", text: "original question" } },
    { seqStart: 2, seqEnd: 2, timestamp: at, item: { type: "assistant_message", messageId: "a1", text: "original answer" } },
  ]);
  const { session, host } = await setup(t, client);
  const id = await mirrored(session, "Chat existing");
  await session.call("session.sync", { chat: id, since: null });
  const initial = host.external.state(id);
  await session.call("session.sync", { chat: id, since: null });
  assert.deepEqual(host.external.state(id), initial, "reloading history never duplicates journal entities or activity");
  assert.deepEqual(initial.entities.map((entry) => entry.kind), ["prompt", "reply"]);
  assert.equal((await session.call("chats.list", {})).chats.some((entry) => entry.title === "Chat foreign"), false);
  const status = await session.call("backend.status", {});
  assert.equal(status.kind, "paseo"); assert.equal(status.model, "same-qwen"); assert.equal(status.contextWindow, 262144);
  assert.deepEqual(client.sends, []); assert.deepEqual(client.cancels, []);
});

test("sending to a running imported chat queues locally and submits only to that agent after it becomes idle", async (t) => {
  const client = new FakeClient();
  client.agents.set("busy", agent("busy", "running"));
  client.agents.set("other", agent("other", "running"));
  const { session, host } = await setup(t, client);
  const id = await mirrored(session, "Chat busy");
  await session.call("session.sync", { chat: id, since: null });
  await session.call("chat.send", { chat: id, text: "next instruction", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(client.sends.length, 0);
  client.agents.set("busy", agent("busy", "idle"));
  await session.call("session.sync", { chat: id, since: null });
  await settled();
  assert.equal(client.sends.length, 1); assert.equal(client.sends[0]?.id, "busy");
  assert.equal(client.sends[0]?.text, "next instruction"); assert.deepEqual(client.cancels, []);
  await session.call("session.sync", { chat: id, since: null });
  const prompts = host.external.state(id).entities.filter((entry) => entry.kind === "prompt");
  assert.equal(prompts.length, 1, "the Paseo echo and the phone's optimistic prompt share one entity id");
  assert.equal(prompts[0]?.text, "next instruction");
});

test("a running turn marks only its own reply streaming and updates each tool card in place", async (t) => {
  const client = new FakeClient();
  const working = { ...agent("busy", "running"), activeTurn: { turnId: "turn-current" } };
  client.agents.set("busy", working);
  client.entries.set("busy", [
    { seqStart: 1, seqEnd: 1, timestamp: at, turnId: "turn-old", item: { type: "assistant_message", messageId: "old", text: "finished before" } },
    { seqStart: 2, seqEnd: 2, timestamp: at, turnId: "turn-current", item: { type: "assistant_message", messageId: "current", text: "still working" } },
    { seqStart: 3, seqEnd: 3, timestamp: at, turnId: "turn-current", item: { type: "tool_call", callId: "tool-1", name: "exec_command", status: "running", detail: { command: "npm test" } } },
  ]);
  const { session, host } = await setup(t, client);
  const id = await mirrored(session, "Chat busy");
  await session.call("session.sync", { chat: id, since: null });
  const initial = host.external.state(id).entities;
  assert.equal(initial[0]?.kind === "reply" && initial[0].streaming, false);
  assert.equal(initial[1]?.kind === "reply" && initial[1].streaming, true);
  assert.equal(initial[2]?.kind === "task" && initial[2].status, "working");
  client.agents.set("busy", agent("busy", "idle"));
  client.entries.set("busy", [{ seqStart: 3, seqEnd: 4, timestamp: at, turnId: "turn-current", item: { type: "tool_call", callId: "tool-1", name: "exec_command", status: "completed", detail: { command: "npm test", exitCode: 0 } } }]);
  await session.call("session.sync", { chat: id, since: null });
  const done = host.external.state(id);
  assert.equal(done.entities.length, 3);
  assert.equal(done.entities[1]?.kind === "reply" && done.entities[1].streaming, false);
  assert.equal(done.entities[2]?.kind === "task" && done.entities[2].status, "completed");
  assert.equal(done.activity, null);
});

test("removing a phone mirror never cancels the running computer agent or another chat", async (t) => {
  const client = new FakeClient();
  client.agents.set("busy", agent("busy", "running"));
  client.agents.set("other", agent("other", "running"));
  const { session } = await setup(t, client);
  const id = await mirrored(session, "Chat busy");
  await session.call("chats.delete", { id });
  assert.deepEqual(client.cancels, []);
  assert.equal(client.agents.get("busy")?.status, "running");
  assert.equal((await session.call("chats.list", {})).chats.some((entry) => entry.id === id), false);
  const other = await mirrored(session, "Chat other");
  await session.call("chat.stop", { chat: other });
  assert.deepEqual(client.cancels, ["other"]);
});

test("after an Amuse restart the next message resumes the binding without replaying its prior conversation", async (t) => {
  const fixture = await setup(t);
  await fixture.session.call("chat.send", { chat: "main", text: "first instruction", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(fixture.client.sends[0]?.text, "first instruction");
  fixture.bridge.close();
  const host = createHost(ports(), { store: fixture.store });
  const bridge = paseoBridge(fixture.client, fixture.options);
  fixture.bridges.push(bridge);
  const session = await bridge.attach(host);
  await session.call("chat.send", { chat: "main", text: "second instruction", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(fixture.client.created, 1, "an existing binding never creates another Codex session");
  assert.equal(fixture.client.sends.at(-1)?.text, "second instruction", "Paseo owns the prior context; it must not be resent as a migration envelope");
});

test("an agent-update announcement before createAgent resolves binds and sends through only the originating Amuse chat", async (t) => {
  const client = new FakeClient();
  client.announceCreated = true;
  const { session, path } = await setup(t, client);
  const local = await session.call("chats.create", {});
  await session.call("chat.send", { chat: local.id, text: "run this in my new chat", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(client.created, 1);
  assert.equal(client.sends.length, 1, "the queue must drain from the originating chat rather than a competing auto-imported mirror");
  assert.equal(client.sends[0]?.id, "created-1");
  assert.equal(client.sends[0]?.text, "run this in my new chat");
  const saved = JSON.parse(readFileSync(path, "utf8")) as { bindings: Record<string, string> };
  assert.deepEqual(Object.entries(saved.bindings).filter(([, id]) => id === "created-1"), [[local.id, "created-1"]]);
  assert.equal((await session.call("chats.list", {})).chats.length, 2, "main plus the user's new chat, without a duplicate mirror");
});

test("an agent-update announcement inside watch retains the already assigned local binding", async (t) => {
  const client = new FakeClient();
  client.announceWatched = true;
  const { session, path } = await setup(t, client);
  const local = await session.call("chats.create", {});
  await session.call("chat.send", { chat: local.id, text: "watch callback must stay here", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(client.sends.length, 1);
  assert.equal(client.sends[0]?.text, "watch callback must stay here");
  const saved = JSON.parse(readFileSync(path, "utf8")) as { bindings: Record<string, string> };
  assert.deepEqual(Object.entries(saved.bindings).filter(([, id]) => id === "created-1"), [[local.id, "created-1"]]);
});

test("history reconciles an accepted but uncertain delivery before draining subsequent messages", async (t) => {
  const fixture = await setup(t);
  fixture.bridge.close();
  const id = "p-existing";
  const messageId = "p-u-uncertain";
  fixture.client.agents.set("existing", agent("existing"));
  fixture.client.entries.set("existing", [{ seqStart: 1, seqEnd: 1, timestamp: at, item: { type: "user_message", messageId: "accepted", clientMessageId: messageId, text: "already accepted" } }]);
  writeFileSync(fixture.path, JSON.stringify({ version: 1, bindings: { [id]: "existing" }, hidden: [], attachments: {}, queue: [{ id: messageId, chat: id, text: "already accepted", at, timezone: "UTC", attachments: [], state: "sending" }] }));
  const host = createHost(ports());
  const bridge = paseoBridge(fixture.client, fixture.options);
  fixture.bridges.push(bridge);
  const session = await bridge.attach(host);
  await session.call("session.sync", { chat: id, since: null });
  await session.call("chat.send", { chat: id, text: "follow up", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(fixture.client.sends.length, 1, "history acknowledges the old delivery and releases the queue");
  assert.equal(fixture.client.sends[0]?.text, "follow up");
  const saved = JSON.parse(readFileSync(fixture.path, "utf8")) as { queue: { id: string }[] };
  assert.equal(saved.queue.some((item) => item.id === messageId), false);
});

test("new chats add only their browser MCP servers and notify the binding once", async (t) => {
  const mcpServers: PaseoCreateOptions["mcpServers"] = { amuse_browser: { type: "http", url: "http://127.0.0.1:9876/mock-browser" } };
  const minted: string[] = [];
  const fixture = await setup(t, new FakeClient(), {
    browserMcp: (chat) => { minted.push(chat); return mcpServers; },
    browserInstructions: (chat) => `Use the shared browser CLI for ${chat}.`,
  });
  await fixture.session.call("chat.send", { chat: "main", text: "first browser task", timezone: "UTC", attachments: [] });
  await settled();
  assert.deepEqual(fixture.client.createCalls, [{ title: "Amuse", cwd: fixture.options.cwd, options: { mcpServers } }], "no model, provider, permission or system prompt override is added");
  assert.deepEqual(minted, ["main"]);
  assert.equal(fixture.client.sends[0]?.text, "Use the shared browser CLI for main.\n\nfirst browser task");
  assert.equal((JSON.parse(readFileSync(fixture.path, "utf8")) as { browserNotified: Record<string, boolean> }).browserNotified["main"], true);
  await fixture.session.call("session.sync", { chat: "main", since: null });
  await fixture.session.call("chat.send", { chat: "main", text: "follow up", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(fixture.client.created, 1);
  assert.equal(fixture.client.sends.at(-1)?.text, "follow up");
});

test("existing agents mint browser access without restarting and retain the one-time notice across Amuse restarts", async (t) => {
  const client = new FakeClient();
  client.agents.set("old", { ...agent("old"), model: "owner-model", currentModeId: "owner-mode" });
  const minted: string[] = [];
  const fixture = await setup(t, client, {
    browserMcp: (chat) => { minted.push(chat); return { browser: { type: "http", url: "http://127.0.0.1:9876/existing" } }; },
    browserInstructions: (chat) => `Shared browser CLI for ${chat}.`,
  });
  const chat = await mirrored(fixture.session, "Chat old");
  await fixture.session.call("chat.send", { chat, text: "use the browser", timezone: "UTC", attachments: [] });
  await settled();
  assert.deepEqual(minted, [chat]);
  assert.equal(client.created, 0);
  assert.deepEqual(client.cancels, []);
  assert.equal(client.sends[0]?.text, `Shared browser CLI for ${chat}.\n\nuse the browser`);
  fixture.bridge.close();
  const host = createHost(ports(), { store: fixture.store });
  const bridge = paseoBridge(client, fixture.options);
  fixture.bridges.push(bridge);
  const session = await bridge.attach(host);
  await session.call("chat.send", { chat, text: "continue on the same page", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(client.sends.at(-1)?.text, "continue on the same page");
  assert.deepEqual(minted, [chat, chat]);
  assert.equal(client.created, 0, "existing agents never receive new creation options or restart");
  assert.deepEqual(client.cancels, []);
  assert.equal(client.agents.get("old")?.["model"], "owner-model");
  assert.equal(client.agents.get("old")?.["currentModeId"], "owner-mode");
});

test("a native history receipt acknowledges the browser notice after an uncertain send and restart", async (t) => {
  const client = new FakeClient();
  client.failSend = "after";
  const fixture = await setup(t, client, { browserInstructions: () => "Use the browser CLI; no MCP reload is needed." });
  await fixture.session.call("chat.send", { chat: "main", text: "open the page", timezone: "UTC", attachments: [] });
  await settled();
  const uncertain = JSON.parse(readFileSync(fixture.path, "utf8")) as { queue: { browserNotice?: boolean; state: string }[]; browserNotified: Record<string, boolean> };
  assert.equal(uncertain.queue[0]?.state, "sending");
  assert.equal(uncertain.queue[0]?.browserNotice, true, "the notice travels with the uncertain delivery receipt");
  assert.notEqual(uncertain.browserNotified["main"], true, "a rejected transport promise alone cannot acknowledge the notice");
  fixture.bridge.close();
  const host = createHost(ports(), { store: fixture.store });
  const bridge = paseoBridge(client, fixture.options);
  fixture.bridges.push(bridge);
  const session = await bridge.attach(host);
  await session.call("session.sync", { chat: "main", since: null });
  const confirmed = JSON.parse(readFileSync(fixture.path, "utf8")) as { queue: unknown[]; browserNotified: Record<string, boolean> };
  assert.equal(confirmed.queue.length, 0);
  assert.equal(confirmed.browserNotified["main"], true);
  await session.call("chat.send", { chat: "main", text: "next task", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(client.sends.at(-1)?.text, "next task", "the already acknowledged notice is not sent twice");
  assert.equal(client.created, 1);
});

test("a send rejected before any receipt keeps the browser notice pending for explicit retry", async (t) => {
  const client = new FakeClient();
  client.failSend = "before";
  const fixture = await setup(t, client, { browserInstructions: () => "Shared browser access." });
  await fixture.session.call("chat.send", { chat: "main", text: "try the browser", timezone: "UTC", attachments: [] });
  await settled();
  assert.equal(client.entries.get("created-1"), undefined);
  const failure = fixture.host.external.state("main").entities.find((entity) => entity.kind === "failure");
  assert.ok(failure);
  assert.notEqual((JSON.parse(readFileSync(fixture.path, "utf8")) as { browserNotified: Record<string, boolean> }).browserNotified["main"], true);
  await fixture.session.call("chat.retry", { id: failure.id });
  await settled();
  assert.equal(client.sends.length, 2);
  assert.ok(client.sends.every((sent) => sent.text === "Shared browser access.\n\ntry the browser"));
  assert.equal((JSON.parse(readFileSync(fixture.path, "utf8")) as { browserNotified: Record<string, boolean> }).browserNotified["main"], true);
});

test("background helpers inherit the originating chat's MCP and browser CLI instructions", async (t) => {
  const mcpServers: PaseoCreateOptions["mcpServers"] = { browser: { type: "stdio", command: "mock-browser-cli", args: ["--shared"] } };
  const minted: string[] = [];
  const fixture = await setup(t, new FakeClient(), {
    browserMcp: (chat) => { minted.push(chat); return mcpServers; },
    browserInstructions: (chat) => `The same browser and takeover gate belong to ${chat}.`,
  });
  const actions: Parameters<AgentIO["act"]>[0][] = [];
  const io: AgentIO = {
    chat: "main", emit: () => {}, act: (action) => { actions.push(action); return { ok: true, id: "task-browser" }; },
    context: () => "originating chat context", recall: () => "", chats: () => [], schedules: () => [], readChat: () => null,
    decision: async () => ({ verdict: "approved", remember: false }), report: () => {},
    time: () => ({ now: at, timezone: "UTC" }), lastWords: () => "", answer: async () => ({ kind: "closed" }), listen: () => () => {},
  };
  const task: Task = { kind: "task", id: "task-browser", at, title: "browser helper", instructions: "Inspect the same page", steps: [], status: "working", result: null };
  fixture.bridge.executionPorts().task(task, io);
  await settled();
  assert.deepEqual(minted, ["main"]);
  assert.deepEqual(fixture.client.createCalls, [{ title: task.title, cwd: fixture.options.cwd, options: { mcpServers } }]);
  assert.ok(fixture.client.sends[0]?.text.startsWith("The same browser and takeover gate belong to main~task-browser.\n\n"));
  assert.ok(fixture.client.sends[0]?.text.includes("originating chat context"));
  assert.ok(actions.some((action) => action.kind === "taskEnded"));
});

test("browser.open awaits its hook and propagates unavailable or rejected browser service errors", async (t) => {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  const calls: { chat: string; url: string }[] = [];
  const fixture = await setup(t, new FakeClient(), {
    browserOpen: async (chat, url) => { calls.push({ chat, url }); await opened; return { id: "native-browser-1" }; },
  });
  let finished = false;
  const pending = fixture.session.call("browser.open", { chat: "main", url: "https://example.invalid/" }).then((result) => { finished = true; return result; });
  await settled();
  assert.equal(finished, false, "the facade waits for the browser to actually open");
  release();
  assert.deepEqual(await pending, { id: "native-browser-1" });
  assert.deepEqual(calls, [{ chat: "main", url: "https://example.invalid/" }]);
  assert.ok((await fixture.session.call("backend.status", {})).capabilities.includes("同一浏览器画面 / 手机接管"));
  assert.equal(fixture.client.created, 0);
  const rejected = await setup(t, new FakeClient(), { browserOpen: async () => { throw new Error("browser startup unavailable"); } });
  await assert.rejects(rejected.session.call("browser.open", { chat: "main", url: "https://example.invalid/" }), /browser startup unavailable/);
  const unconfigured = await setup(t);
  await assert.rejects(unconfigured.session.call("browser.open", { chat: "main", url: "https://example.invalid/" }), /尚未连接浏览器画面服务/);
  assert.equal((await unconfigured.session.call("backend.status", {})).capabilities.includes("同一浏览器画面 / 手机接管"), false);
});
