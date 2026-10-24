import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { type Ports, type Timers, createHost, memoryRules, noKeys, noLogins, noSandbox, noSecrets } from "@amuse/core";
import type { Schedule } from "@amuse/protocol";
import type { PaseoCreateOptions } from "./paseo-client.ts";
import { type BridgeAgent, type BridgeClient, type BridgeEntry, paseoBridge } from "./paseo.ts";
import { sharedAmuseTools } from "./shared-tools.ts";
import { workspace } from "./workspace.ts";
import { memorySent } from "./sent.ts";

const at = "2026-10-21T08:00:00Z";
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(done: () => boolean) { for (let n = 0; n < 200 && !done(); n++) await settled(); assert.ok(done(), "fixture did not reach the expected state"); }
class FeatureClient implements BridgeClient {
  agents = new Map<string, BridgeAgent>();
  entries = new Map<string, BridgeEntry[]>();
  scopes = new Map<string, string>();
  sends: { id: string; text: string; clientMessageId?: string; activeTurnBehavior?: "steer" | "interrupt" }[] = [];
  cancels: string[] = [];
  listeners = new Set<(event: unknown) => void>();
  waiters = new Map<string, { resolve(): void; reject(error: Error): void }[]>();
  creates: { id: string; options?: PaseoCreateOptions }[] = [];
  busySends = 0;
  rejectedBusyIds = new Set<string>();
  async listAgents() { return [...this.agents.values()].map((agent) => structuredClone(agent)); }
  async createAgent(title?: string, _cwd?: string, options?: PaseoCreateOptions) {
    const id = `feature-${this.creates.length + 1}`;
    this.creates.push({ id, ...(options ? { options } : {}) });
    const cfg = options?.mcpServers?.["amuse_browser"] as { url?: string } | undefined;
    const scope = cfg?.url ? decodeURIComponent(new URL(cfg.url).pathname.slice(1)) : "main";
    this.scopes.set(id, scope);
    const agent: BridgeAgent = { id, provider: "qwen-multi", status: "idle", title: title ?? "Fixture", createdAt: at, updatedAt: at };
    this.agents.set(id, agent);
    for (const listener of this.listeners) listener({ type: "agent_update", agentId: id, payload: { agent } });
    return structuredClone(agent);
  }
  async history(id: string, options?: { after?: { epoch: string; seq: number } }) {
    if (this.scopes.get(id)?.includes("~") && this.agents.get(id)?.status === "running") await new Promise<void>((resolve, reject) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), { resolve, reject }]));
    const entries = this.entries.get(id) ?? [];
    return { agent: structuredClone(this.agents.get(id) ?? null), entries: structuredClone(entries.filter((entry) => entry.seqEnd > (options?.after?.seq ?? 0))), epoch: "features", endCursor: { epoch: "features", seq: entries.at(-1)?.seqEnd ?? 0 } };
  }
  async watch() {}
  subscribe(listener: (event: unknown) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async send(id: string, text: string, options?: { clientMessageId?: string; activeTurnBehavior?: "steer" | "interrupt" }) {
    this.sends.push({ id, text, ...options });
    if (options?.clientMessageId && this.rejectedBusyIds.has(options.clientMessageId)) throw new Error("agent_request_outcome_unknown");
    if (this.busySends > 0) { this.busySends--; if (options?.clientMessageId) this.rejectedBusyIds.add(options.clientMessageId); throw new Error("The local Qwen worker is busy. Another native team owns its lease."); }
    const agent = this.agents.get(id)!; this.agents.set(id, { ...agent, status: "running" });
    const old = this.entries.get(id) ?? []; const seq = (old.at(-1)?.seqEnd ?? 0) + 1;
    this.entries.set(id, [...old, { seqStart: seq, seqEnd: seq, timestamp: at, turnId: `turn-${seq}`, item: { type: "user_message", messageId: `u-${seq}`, text, clientMessageId: options?.clientMessageId } }]);
  }
  finish(id: string, text: string) {
    const old = this.entries.get(id) ?? []; const seq = (old.at(-1)?.seqEnd ?? 0) + 1;
    this.entries.set(id, [...old, { seqStart: seq, seqEnd: seq, timestamp: at, turnId: old.at(-1)?.turnId ?? "turn-1", item: { type: "assistant_message", messageId: `a-${seq}`, text } }]);
    this.agents.set(id, { ...this.agents.get(id)!, status: "idle" });
    for (const waiter of this.waiters.get(id) ?? []) waiter.resolve(); this.waiters.delete(id);
  }
  async cancel(id: string) { this.cancels.push(id); this.finish(id, ""); }
  async rename() {}
  async respondPermission() {}
  close() { for (const values of this.waiters.values()) for (const waiter of values) waiter.reject(new Error("test fixture closed")); this.waiters.clear(); }
}

async function setup(t: TestContext, readiness?: () => boolean) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-paseo-features-"));
  const files = workspace(join(dir, "workspace"), memorySent(), dir); const rules = memoryRules();
  const client = new FeatureClient();
  let now = Date.parse(at); let next = 0;
  const pending = new Map<number, { at: number; run(): void }>();
  const timers: Timers<number> = { set: (ms, run) => { pending.set(++next, { at: now + ms, run }); return next; }, clear: (id) => { pending.delete(id); } };
  const bridge = paseoBridge(client, { path: join(dir, "bindings.json"), cwd: dir, workspaceRoot: join(dir, "workspace"), files, model: "same-owner-qwen", contextWindow: 262144, steer: true,
    browserMcp: (chat, run) => ({ amuse_browser: { type: "http", url: `http://fixture.invalid/${encodeURIComponent(run ? `${chat}~${run}` : chat)}` } }), browserInstructions: (scope) => `ACTOR ${scope}`,
    prepare: async () => "Prepared memory, skills and goal context",
    ...(readiness ? { ready: readiness } : {}),
  });
  const ports: Ports = { files, rules, keys: noKeys, logins: noLogins, sandbox: noSandbox, secrets: noSecrets,
    browse: () => {}, job: () => {}, browser: () => {}, approval: () => {}, fit: () => {}, connect: async () => "",
    apps: { access: async () => ({ kind: "managed" }), cannotConnect: async () => null, connectKey: async () => { throw new Error("No key connection in this fixture."); }, search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "", disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
    ...bridge.executionPorts(),
  };
  const host = createHost(ports, { clock: { now: () => new Date(now).toISOString() }, timers });
  const session = await bridge.attach(host);
  const api = sharedAmuseTools({ host: () => host, context: bridge.toolContext, config: { files, rules }, directory: join(dir, "codemode") });
  const call = async (scope: string, name: string, args: Record<string, unknown>) => {
    const tool = api.tools(scope).find((tool) => tool.name === name); assert.ok(tool, `${scope}: ${name}`);
    return tool.execute("test-call", args, new AbortController().signal);
  };
  const advance = (ms: number) => { const end = now + ms; for (;;) { const due = [...pending.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; pending.delete(due[0]); now = due[1].at; due[1].run(); } now = end; };
  const actorFor = (run: string) => [...client.scopes.entries()].find(([, scope]) => scope === `main~${run}`)?.[0];
  const task = async () => { const started = host.agent("main").act({ kind: "task", title: "Fixture helper", instructions: "Inspect a fixture" }); assert.ok(started.ok); await until(() => Boolean(actorFor(started.id))); await until(() => client.sends.some((send) => send.id === actorFor(started.id))); return { id: started.id, agent: actorFor(started.id)!, scope: `main~${started.id}` }; };
  const schedule = async (goal: string | null = null) => { const scheduled = host.agent("main").act({ kind: "schedule", title: "Fixture schedule", instructions: "Check the fixture, report only new actionable facts", when: { kind: "once", at: new Date(now + 60_000).toISOString() }, needs: null, goal }); assert.ok(scheduled.ok); advance(60_000); await settled(); return scheduled.id; };
  const state = (id: string) => host.external.state("main").entities.find((entity) => entity.id === id);
  t.after(async () => { bridge.close(); await settled(); assert.equal(dirname(dir), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); });
  return { dir, files, host, bridge, session, client, call, advance, task, schedule, state, actorFor };
}
const text = (value: unknown) => JSON.stringify(value);

test("a message added to an active Paseo conversation steers that agent without cancelling or changing its model", async (t) => {
  const f = await setup(t);
  await f.session.call("chat.send", { chat: "main", text: "First instruction", timezone: "UTC", attachments: [] }); await settled();
  const id = f.client.sends[0]!.id;
  await f.session.call("chat.send", { chat: "main", text: "Correction while running", timezone: "UTC", attachments: [] }); await settled();
  assert.equal(f.client.sends.length, 2);
  assert.equal(f.client.sends[1]?.id, id);
  assert.equal(f.client.sends[1]?.activeTurnBehavior, "steer");
  assert.deepEqual(f.client.cancels, []);
  assert.equal(f.client.creates.length, 1);
  const status = await f.session.call("backend.status", {});
  assert.equal(status.model, "same-owner-qwen"); assert.equal(status.contextWindow, 262144);
  assert.ok(f.client.sends[0]?.text.includes("Prepared memory, skills and goal context"));
});

test("no_reply hides a background note's reply and echo, while the next user message is still answered", async (t) => {
  const f = await setup(t);
  await f.session.call("chat.send", { chat: "main", text: "Human message", timezone: "UTC", attachments: [] }); await settled();
  const id = f.client.sends[0]!.id;
  assert.match(text(await f.call("main", "no_reply", {})), /user wrote/);
  f.client.finish(id, "Human answer"); await f.session.call("session.sync", { chat: "main", since: null });
  f.host.agent("main").report("Nothing changed in background");
  await until(() => f.client.sends.length === 2);
  assert.match(text(await f.call("main", "no_reply", {})), /Nothing is shown/);
  f.client.finish(id, "This quiet final must not be shown"); await f.session.call("session.sync", { chat: "main", since: null });
  let feed = f.host.external.state("main").entities;
  assert.ok(!feed.some((entity) => (entity.kind === "prompt" || entity.kind === "reply") && /quiet final|Nothing changed/.test(entity.text)));
  const saved = JSON.parse(readFileSync(join(f.dir, "bindings.json"), "utf8")) as { silenced: string[] }; assert.equal(saved.silenced.length, 1, "suppression survives Amuse restart via the binding store");
  await f.session.call("chat.send", { chat: "main", text: "Please answer this new message", timezone: "UTC", attachments: [] }); await settled();
  assert.match(text(await f.call("main", "no_reply", {})), /user wrote/);
  f.client.finish(id, "The next human is answered"); await f.session.call("session.sync", { chat: "main", since: null });
  feed = f.host.external.state("main").entities;
  assert.ok(feed.some((entity) => entity.kind === "reply" && entity.text === "The next human is answered"));
  assert.equal(feed.filter((entity) => entity.kind === "prompt").length, 2, "the background note echo is hidden");
});

test("no_reply also hides assistant text already streamed during the same background note", async (t) => {
  const f = await setup(t);
  await f.session.call("chat.send", { chat: "main", text: "Human message", timezone: "UTC", attachments: [] }); await settled();
  const id = f.client.sends[0]!.id;
  f.client.finish(id, "Human answer"); await f.session.call("session.sync", { chat: "main", since: null });
  f.host.agent("main").report("An internal maintenance note"); await until(() => f.client.sends.length === 2);
  f.client.finish(id, "Internal assistant commentary before deciding to stay quiet");
  f.client.agents.set(id, { ...f.client.agents.get(id)!, status: "running" });
  await f.session.call("session.sync", { chat: "main", since: null });
  assert.match(text(await f.call("main", "no_reply", {})), /Nothing is shown/);
  f.client.finish(id, "Internal quiet final"); await f.session.call("session.sync", { chat: "main", since: null });
  assert.ok(!f.host.external.state("main").entities.some((entity) => entity.kind === "reply" && /Internal assistant|Internal quiet/.test(entity.text)), "a quiet turn must not leave earlier commentary in the chat");
});

test("a background note without no_reply publishes only its final result once", async (t) => {
  const f = await setup(t);
  await f.session.call("chat.send", { chat: "main", text: "Human message", timezone: "UTC", attachments: [] }); await settled();
  const id = f.client.sends[0]!.id;
  f.client.finish(id, "Human answer"); await f.session.call("session.sync", { chat: "main", since: null });
  f.host.agent("main").report("A useful update from background work"); await until(() => f.client.sends.length === 2);
  f.client.finish(id, "Private intermediate commentary"); f.client.agents.set(id, { ...f.client.agents.get(id)!, status: "running" });
  await f.session.call("session.sync", { chat: "main", since: null });
  assert.ok(!f.host.external.state("main").entities.some((entity) => entity.kind === "reply" && /Private intermediate/.test(entity.text)));
  f.client.finish(id, "A concise useful final update"); await f.session.call("session.sync", { chat: "main", since: null });
  await f.session.call("session.sync", { chat: "main", since: null });
  const replies = f.host.external.state("main").entities.filter((entity) => entity.kind === "reply");
  assert.equal(replies.filter((reply) => reply.text === "A concise useful final update").length, 1);
  assert.ok(!replies.some((reply) => /Private intermediate/.test(reply.text)));
});

test("background helpers stay hidden, use actor scope, and support plan, message_run and ask_user", async (t) => {
  const f = await setup(t); const run = await f.task();
  assert.equal((await f.session.call("chats.list", {})).chats.length, 1, "native helper announcements are never mirrored as user chats");
  assert.ok(f.client.sends[0]?.text.startsWith(`ACTOR ${run.scope}\n\n`));
  assert.throws(() => f.bridge.toolContext(`not-main~${run.id}`), /ended|结束/);
  await f.call(run.scope, "plan", { steps: [{ label: "Inspect", done: false }] });
  const task = f.state(run.id); assert.ok(task?.kind === "task"); assert.deepEqual(task.steps, [{ label: "Inspect", done: false }]);
  await f.call("main", "message_run", { status: "追加要求", run: run.id, text: "Inspect the second fixture too" }); await settled();
  assert.ok(f.client.sends.some((send) => send.id === run.agent && send.activeTurnBehavior === "steer" && send.text.includes("Inspect the second fixture too")));
  const asked = f.call(run.scope, "ask_user", { status: "询问", question: "Which fixture should be used?" });
  await until(() => f.host.external.state("main").entities.some((entity) => entity.kind === "question"));
  const question = f.host.external.state("main").entities.find((entity) => entity.kind === "question"); assert.ok(question?.kind === "question");
  await f.call("main", "answer_question", { status: "回答", question: question.id, answer: "The second fixture" });
  assert.match(text(await asked), /The second fixture/);
  f.client.finish(run.agent, "Inspected the second fixture"); await until(() => f.state(run.id)?.kind === "task" && (f.state(run.id) as { status: string }).status === "completed");
});

test("stopping a helper cancels only its native actor and immediately aborts pending tool waits", async (t) => {
  const f = await setup(t); const run = await f.task();
  const signal = f.bridge.toolContext(run.scope).run!.stop;
  const stopped = f.call("main", "stop_run", { status: "停止", run: run.id });
  assert.equal(signal.aborted, true, "a stop must abort the tools immediately, not after the next history poll");
  await stopped;
  assert.deepEqual(f.client.cancels, [run.agent]);
  assert.equal((f.state(run.id) as { status: string }).status, "stopped");
});

test("a background helper returns to working after the busy worker lease becomes available", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await setup(t); f.client.busySends = 1; const run = await f.task();
  await until(() => (f.state(run.id) as { status: string }).status === "waiting");
  assert.deepEqual(f.client.cancels, []);
  t.mock.timers.tick(15_000); await settled();
  await until(() => f.client.sends.filter((send) => send.id === run.agent).length === 2);
  assert.notEqual(f.client.sends[0]?.clientMessageId, f.client.sends[1]?.clientMessageId, "a background worker also needs a fresh delivery id after an explicit refusal");
  assert.equal((f.state(run.id) as { status: string }).status, "working");
  f.client.finish(run.agent, "Finished after waiting for the lease");
  await until(() => (f.state(run.id) as { status: string }).status === "completed");
});

test("a background helper waits for the shared tool endpoint before creating its native actor", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let ready = false; const f = await setup(t, () => ready);
  const started = f.host.agent("main").act({ kind: "task", title: "Wait for startup", instructions: "Use the tools after startup" }); assert.ok(started.ok);
  await settled(); assert.equal(f.client.creates.length, 0); assert.equal(f.client.sends.length, 0);
  ready = true; t.mock.timers.tick(100); await until(() => Boolean(f.actorFor(started.id)));
  const actor = f.actorFor(started.id)!; await until(() => f.client.sends.some((send) => send.id === actor));
  assert.match(f.client.sends[0]!.text, /Prepared memory, skills and goal context/);
  f.client.finish(actor, "Started with the service ready"); await until(() => (f.state(started.id) as { status: string }).status === "completed");
});

test("schedules finish quietly unless report is called, and a final record is never a user notification", async (t) => {
  const f = await setup(t); const id = await f.schedule();
  await until(() => Boolean(f.actorFor(id))); const actor = f.actorFor(id)!;
  f.client.finish(actor, "No changes in the fixture");
  await until(() => (f.state(id) as Schedule).last?.outcome === "quiet");
  assert.equal(f.client.sends.length, 1, "only the helper was briefed; no foreground note was sent");
  assert.equal((await f.session.call("chats.list", {})).chats.length, 1);
  assert.equal((f.state(id) as Schedule).last?.summary, "No changes in the fixture");
});

test("a schedule reports at most once and records a reported outcome", async (t) => {
  const f = await setup(t); const id = await f.schedule(); await until(() => Boolean(f.actorFor(id)));
  const actor = f.actorFor(id)!; const scope = `main~${id}`;
  await f.call(scope, "report", { message: "A new actionable fixture result" });
  await f.call(scope, "report", { message: "Must not report twice" }); await settled();
  assert.equal(f.client.sends.filter((send) => !f.client.scopes.get(send.id)?.includes("~") && send.text.includes("A new actionable fixture result")).length, 1);
  assert.ok(!f.client.sends.some((send) => send.text.includes("Must not report twice")));
  f.client.finish(actor, "Private final run record");
  await until(() => (f.state(id) as Schedule).last?.outcome === "reported");
  assert.ok(!f.client.sends.some((send) => !f.client.scopes.get(send.id)?.includes("~") && send.text.includes("Private final run record")));
});

test("a schedule that already reported keeps that outcome when later private work fails", async (t) => {
  const f = await setup(t); const id = await f.schedule(); await until(() => Boolean(f.actorFor(id)));
  const actor = f.actorFor(id)!;
  await f.call(`main~${id}`, "report", { message: "The actionable result was delivered" });
  f.client.finish(actor, "A later private follow-up failed");
  f.client.agents.set(actor, { ...f.client.agents.get(actor)!, status: "error", lastError: "Follow-up failed" });
  await until(() => Boolean((f.state(id) as Schedule).last));
  assert.equal((f.state(id) as Schedule).last?.outcome, "reported", "match the upstream schedule runner: a delivered report remains the outcome");
  assert.equal((f.state(id) as Schedule).last?.summary, "A later private follow-up failed");
});

test("a done goal skips its scheduled run without opening a model session", async (t) => {
  const f = await setup(t); const goal = await f.host.call("goals.add", { title: "Done fixture", about: "Already done" });
  await f.host.call("goals.update", { id: goal.id, status: "done" });
  const id = await f.schedule(goal.id);
  await until(() => !(f.state(id) as Schedule).running);
  assert.equal(f.client.creates.length, 0);
  assert.equal((f.state(id) as Schedule).last, null, "skipped runs do not replace the previous record");
});

test("a muted goal writes reports into its log and keeps the chat quiet", async (t) => {
  const f = await setup(t); const goal = await f.host.call("goals.add", { title: "Muted fixture", about: "Keep working quietly" });
  await f.host.call("goals.update", { id: goal.id, muted: true });
  const id = await f.schedule(goal.id); await until(() => Boolean(f.actorFor(id)));
  await f.call(`main~${id}`, "report", { message: "A useful private update" });
  assert.match(text((await f.host.call("goals.get", { id: goal.id })).log), /A useful private update/);
  f.client.finish(f.actorFor(id)!, "Saved to the goal log");
  await until(() => (f.state(id) as Schedule).last?.outcome === "quiet");
  assert.equal(f.client.sends.length, 1);
});
