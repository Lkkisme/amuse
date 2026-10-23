import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createHost, memoryRules, noKeys, noLogins, noSandbox, noWorkspace, type Ports } from "@amuse/core";
import { paseoBridge } from "./paseo.ts";
import { connectPaseo, type PaseoAgent, type PaseoClientEvent, type PaseoDirectoryPage, type PaseoTimeline, type PaseoTimelineEntry } from "./paseo-client.ts";

const agent = (id: string): PaseoAgent => ({
  id, provider: "qwen-multi", cwd: "D:/work", model: "profile-default", title: id, status: "idle",
  createdAt: "2026-10-21", updatedAt: "2026-10-21", lastUserMessageAt: null, pendingPermissions: [], persistence: null, labels: {},
});
const directory = (ids: string[], next: string | null = null): PaseoDirectoryPage => ({
  requestId: "r", entries: ids.map((id) => ({ agent: agent(id) })), pageInfo: { nextCursor: next, prevCursor: null, hasMore: next !== null },
});
const row = (seq: number): PaseoTimelineEntry => ({
  provider: "qwen-multi", item: { type: "assistant_message", text: `synthetic ${seq}` }, timestamp: "2026-10-21",
  seqStart: seq, seqEnd: seq, sourceSeqRanges: [{ startSeq: seq, endSeq: seq }], collapsed: [],
});
const timeline = (seqs: number[], older = false, epoch = "e1"): PaseoTimeline => ({
  requestId: "r", agentId: "a", agent: agent("a"), epoch, direction: "tail", projection: "projected",
  reset: false, staleCursor: false, gap: false, window: { minSeq: 1, maxSeq: 9, nextSeq: 10 },
  startCursor: seqs.length ? { epoch, seq: Math.min(...seqs) } : null,
  endCursor: seqs.length ? { epoch, seq: Math.max(...seqs) } : null,
  hasOlder: older, hasNewer: false, entries: seqs.map(row), error: null,
});

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-paseo-client-"));
  const clientModule = join(dir, "client.mjs");
  const key = `amusePaseoTest${Math.random()}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  const calls: { method: string; args: unknown[] }[] = [];
  let events: ((event: unknown) => void) | undefined;
  let timelineEvents: ((event: unknown) => void) | undefined;
  let catalogObserver: { snapshot(value: PaseoDirectoryPage): void } | undefined;
  let connectionListener: ((state: unknown) => void) | undefined;
  let reconnectEnabled = false;
  let watchReady = Promise.resolve();
  const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }); };
  const driver = {
    setReconnectEnabled(enabled: boolean) { reconnectEnabled = enabled; record("setReconnectEnabled", enabled); },
    async fetchAgents(...args: unknown[]) { record("fetchAgents", ...args); return directory([]); },
    observeAgents(...args: unknown[]) {
      record("observeAgents", ...args);
      return { ready: Promise.resolve(directory([])), subscribe(observer: typeof catalogObserver) { catalogObserver = observer; return () => record("removeCatalog"); }, async release() { record("releaseCatalog"); } };
    },
    async createAgent(...args: unknown[]) { record("createAgent", ...args); return agent("new"); },
    async fetchAgentTimeline(...args: unknown[]) { record("history", ...args); return timeline([]); },
    subscribeAgentTimeline(id: string, listener: (event: unknown) => void) {
      record("watch", id); timelineEvents = listener;
      return Object.assign(() => record("watchUnsubscribe"), { ready: watchReady, async release() { record("releaseWatch", id); } });
    },
    subscribe(listener: (event: unknown) => void) { events = listener; return () => record("removeEvents"); },
    subscribeConnectionStatus(listener: (state: unknown) => void) { connectionListener = listener; listener({ status: "connected" }); return () => record("removeConnection"); },
    async sendMessage(...args: unknown[]) { record("send", ...args); },
    async cancelAgent(...args: unknown[]) { record("cancel", ...args); },
    async updateAgent(...args: unknown[]) { record("rename", ...args); },
    async respondToPermission(...args: unknown[]) { record("permission", ...args); },
    async close() { record("close"); },
  };
  globals[key] = (options: unknown) => { record("connect", options); return driver; };
  writeFileSync(clientModule, `export async function connectToDaemon(options) { return globalThis[${JSON.stringify(key)}](options); }`);
  t.after(() => { delete globals[key]; rmSync(dir, { recursive: true, force: true }); });
  return {
    calls, driver, config: { home: dir, clientModule, cwd: dir },
    emit: (event: unknown) => events?.(event),
    emitTimeline: (event: unknown) => timelineEvents?.(event),
    emitCatalog: (page: PaseoDirectoryPage) => catalogObserver?.snapshot(page),
    disconnect: () => connectionListener?.({ status: "disconnected", reason: "synthetic transport lost" }),
    restore: (page: PaseoDirectoryPage, watchedId = "a") => {
      if (!reconnectEnabled) return false;
      connectionListener?.({ status: "connected" });
      catalogObserver?.snapshot(page);
      timelineEvents?.({ type: "agent.timeline.subscription_restored", payload: { agentId: watchedId, subscriptionId: "restored" } });
      return true;
    },
    watchReady: (ready: Promise<void>) => { watchReady = ready; },
  };
}

test("connect reuses the selected daemon and lists every metadata page", async (t) => {
  const f = await fixture(t);
  let n = 0;
  f.driver.fetchAgents = async (...args) => { f.calls.push({ method: "fetchAgents", args }); return n++ === 0 ? directory(["a"], "next") : directory(["b"]); };
  const client = await connectPaseo(f.config);
  assert.deepEqual((await client.listAgents()).map((a) => a.id), ["a", "b"]);
  assert.deepEqual(f.calls.find((c) => c.method === "connect")?.args, [{ target: { kind: "instance", home: f.config.home }, timeout: 15_000 }]);
  const pages = f.calls.filter((c) => c.method === "fetchAgents");
  assert.deepEqual((pages[1]?.args[0] as { page: unknown }).page, { limit: 200, cursor: "next" });
  assert.ok(!f.calls.some((c) => c.method === "history"));
  await client.close();
});

test("create preserves the existing profile; send IDs and approvals reach native APIs", async (t) => {
  const f = await fixture(t);
  const client = await connectPaseo(f.config);
  await client.createAgent(" New title ");
  assert.deepEqual(f.calls.find((c) => c.method === "createAgent")?.args, [{ provider: "qwen-multi", cwd: f.config.cwd, title: "New title" }]);
  const mcpServers = { amuse_browser: { type: "http" as const, url: "http://127.0.0.1:8082/mcp/browser", headers: { Authorization: "Bearer synthetic-capability" } } };
  await client.createAgent("Browser task", undefined, { mcpServers, systemPrompt: "Synthetic additional instructions" });
  assert.deepEqual(f.calls.filter((c) => c.method === "createAgent")[1]?.args, [{
    provider: "qwen-multi", cwd: f.config.cwd, title: "Browser task", mcpServers, systemPrompt: "Synthetic additional instructions",
  }]);
  const attachments = [{ type: "text", mimeType: "text/plain", text: "synthetic attachment" }];
  await client.send("a", "synthetic prompt", { clientMessageId: "p-1", attachments });
  assert.deepEqual(f.calls.find((c) => c.method === "send")?.args, ["a", "synthetic prompt", { messageId: "p-1", activeTurnBehavior: "steer", attachments }]);
  assert.throws(() => client.send("a", "x", { messageId: "one", clientMessageId: "two" }), /Conflicting/);
  await client.respondPermission("a", "request-1", { behavior: "deny", message: "User declined" });
  assert.deepEqual(f.calls.find((c) => c.method === "permission")?.args, ["a", "request-1", { behavior: "deny", message: "User declined" }]);
  await client.rename("a", " Renamed ");
  assert.deepEqual(f.calls.find((c) => c.method === "rename")?.args, ["a", { name: "Renamed" }]);
  await client.close();
  assert.ok(!f.calls.some((c) => c.method === "cancel"));
  assert.throws(() => client.createAgent(), /closed/);
});

test("history pages backwards, deduplicates boundaries and preserves projected rows", async (t) => {
  const f = await fixture(t);
  let n = 0;
  f.driver.fetchAgentTimeline = async (...args) => { f.calls.push({ method: "history", args }); return n++ === 0 ? timeline([3, 4], true) : timeline([1, 2, 3]); };
  const client = await connectPaseo(f.config);
  const result = await client.history("a");
  assert.deepEqual(result.entries.map((e) => e.seqStart), [1, 2, 3, 4]);
  assert.equal(result.hasOlder, false);
  assert.deepEqual(result.startCursor, { epoch: "e1", seq: 1 });
  assert.deepEqual(result.endCursor, { epoch: "e1", seq: 4 });
  assert.deepEqual(f.calls.filter((c) => c.method === "history")[1]?.args, ["a", { direction: "before", projection: "projected", limit: 200, cursor: { epoch: "e1", seq: 3 }, timeout: 15_000 }]);
  await client.close();
});

test("incremental history follows after cursors and replaces a stale epoch", async (t) => {
  const f = await fixture(t);
  let n = 0;
  f.driver.fetchAgentTimeline = async (...args) => {
    f.calls.push({ method: "history", args });
    const page = timeline(n++ === 0 ? [5, 6] : [7, 8]);
    page.direction = "after";
    page.hasNewer = n === 1;
    return page;
  };
  const client = await connectPaseo(f.config);
  const incremental = await client.history("a", { after: { epoch: "e1", seq: 4 } });
  assert.deepEqual(incremental.entries.map((e) => e.seqStart), [5, 6, 7, 8]);
  assert.deepEqual(incremental.endCursor, { epoch: "e1", seq: 8 });
  assert.equal(incremental.hasNewer, false);
  n = 0;
  f.driver.fetchAgentTimeline = async (...args) => {
    f.calls.push({ method: "history", args });
    return n++ === 0 ? { ...timeline([2], false, "e2"), reset: true } : timeline([1, 2], false, "e2");
  };
  const replaced = await client.history("a", { after: { epoch: "e1", seq: 8 } });
  assert.equal(replaced.epoch, "e2");
  assert.equal(replaced.reset, true);
  assert.deepEqual(replaced.entries.map((e) => e.seqStart), [1, 2]);
  await client.close();
});

test("history refuses loops and never combines rows across epochs", async (t) => {
  const f = await fixture(t);
  f.driver.fetchAgentTimeline = async () => timeline([3], true);
  const client = await connectPaseo(f.config);
  await assert.rejects(client.history("a"), /non-progressing/);
  let n = 0;
  f.driver.fetchAgentTimeline = async () => timeline([++n], true, `epoch-${n}`);
  await assert.rejects(client.history("a"), /changed repeatedly/);
  await client.close();
});

test("projected incremental updates replace the whole anchored item and retain an idle cursor", async (t) => {
  const f = await fixture(t);
  let n = 0;
  f.driver.fetchAgentTimeline = async () => {
    const page = timeline([3]);
    const entry = page.entries[0]!;
    entry.seqEnd = n++ === 0 ? 7 : 9;
    entry.item.text = entry.seqEnd === 7 ? "complete first text" : "complete first text extended";
    entry.sourceSeqRanges = [{ startSeq: 3, endSeq: entry.seqEnd }];
    page.endCursor = { epoch: "e1", seq: entry.seqEnd };
    page.hasNewer = n === 1;
    return page;
  };
  const client = await connectPaseo(f.config);
  const merged = await client.history("a", { after: { epoch: "e1", seq: 4 } });
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0]?.item.text, "complete first text extended");
  assert.equal(merged.entries[0]?.seqEnd, 9);
  f.driver.fetchAgentTimeline = async () => timeline([]);
  const idle = await client.history("a", { after: { epoch: "e1", seq: 9 } });
  assert.deepEqual(idle.endCursor, { epoch: "e1", seq: 9 });
  await client.close();
});

test("watches await readiness, share a subscription and forward each stream once", async (t) => {
  const f = await fixture(t);
  let ready!: () => void;
  f.watchReady(new Promise<void>((resolve) => { ready = resolve; }));
  const client = await connectPaseo(f.config);
  const events: PaseoClientEvent[] = [];
  client.subscribe((event) => events.push(event));
  const first = client.watch("a");
  const second = client.watch("a");
  let established = false;
  void first.then(() => { established = true; });
  await Promise.resolve();
  assert.equal(established, false);
  ready();
  const [release1, release2] = await Promise.all([first, second]);
  assert.equal(f.calls.filter((c) => c.method === "watch").length, 1);
  const event = { type: "agent_stream", agentId: "a", event: { type: "timeline", item: row(1).item }, timestamp: "now", seq: 1, epoch: "e1" };
  f.emit(event);
  f.emitTimeline({ type: "agent_stream", payload: event });
  assert.equal(events.filter((e) => e.type === "agent_stream").length, 1);
  f.emitTimeline({ type: "agent.timeline.replacement", payload: { agentId: "a", epoch: "e2" } });
  assert.ok(events.some((e) => e.type === "timeline" && e.message.type === "agent.timeline.replacement"));
  await release1();
  assert.equal(f.calls.filter((c) => c.method === "releaseWatch").length, 0);
  await release2();
  await release2();
  assert.equal(f.calls.filter((c) => c.method === "releaseWatch").length, 1);
  await client.close();
  await client.close();
  assert.equal(f.calls.filter((c) => c.method === "close").length, 1);
});

test("failed watch setup releases its subscription and close never cancels a run", async (t) => {
  const f = await fixture(t);
  const client = await connectPaseo(f.config);
  f.watchReady(Promise.reject(new Error("synthetic subscription failure")));
  await assert.rejects(client.watch("a"), /synthetic subscription failure/);
  assert.equal(f.calls.filter((c) => c.method === "releaseWatch").length, 1);
  await client.close();
  assert.ok(!f.calls.some((c) => c.method === "cancel"));
});

test("supported SDK recovery restores thirteen original sessions and settles bridge activity without replaying an uncertain send", async (t) => {
  const f = await fixture(t);
  const originals = Array.from({ length: 13 }, (_, index) => ({ ...agent(`native-${index}`),
    persistence: { provider: "qwen-multi", sessionId: `original-session-${index}` },
    ...(index === 0 ? { status: "running", activeTurn: { turnId: "existing-turn", startedAt: "2026-10-21T00:00:00Z" } } : {}),
  }));
  let current = originals;
  const page = (): PaseoDirectoryPage => ({ ...directory([]), entries: current.map((native) => ({ agent: structuredClone(native) })) });
  f.driver.fetchAgents = async () => page();
  const client = await connectPaseo(f.config);
  const observed: PaseoClientEvent[] = [];
  client.subscribe((event) => observed.push(event));
  f.emitCatalog(page());
  const release = await client.watch("native-0");
  const ports: Ports = {
    prompt: () => { throw new Error("This recovery must never start a model or replay a prompt."); },
    interrupt: () => {}, title: async () => "unused", browse: () => {}, job: () => {}, task: () => {}, schedule: () => {}, browser: () => {}, approval: () => {}, stopTask: () => {}, fit: () => {}, connect: async () => "",
    apps: { search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "", disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
    rules: memoryRules(), keys: noKeys, files: noWorkspace, logins: noLogins, sandbox: noSandbox,
  };
  const host = createHost(ports);
  const path = join(f.config.home, "bridge.json");
  const bridge = paseoBridge(client, { path, cwd: f.config.cwd, workspaceRoot: f.config.cwd, model: "same-qwen", contextWindow: 262144,
    files: { ...noWorkspace, save: async () => null, find: () => null, serve: async () => null },
  });
  t.after(async () => { await bridge.close(); });
  const session = await bridge.attach(host);
  const binding = JSON.parse(readFileSync(path, "utf8")) as { bindings: Record<string, string>; queue: unknown[] };
  const mirrored = Object.entries(binding.bindings).find(([, id]) => id === "native-0")![0];
  assert.equal(host.external.state(mirrored).activity?.kind, "working");

  // The daemon may have received this one explicit send before its ACK is lost.
  f.driver.sendMessage = async (...args) => { f.calls.push({ method: "send", args }); f.disconnect(); throw new Error("synthetic lost acknowledgement"); };
  await assert.rejects(client.send("native-0", "one explicit synthetic message", { messageId: "original-message-id" }), /lost acknowledgement/);
  assert.equal(bridge.status().connected, false, "the UI must reflect a lost connection rather than invent idle");
  assert.equal(host.external.state(mirrored).activity?.kind, "working", "disconnect alone must not clear task activity");
  assert.throws(() => client.send("native-0", "must not enter the SDK send queue"), /temporarily disconnected/);
  assert.throws(() => client.createAgent("must not create a replacement"), /temporarily disconnected/);
  const lastState: PaseoClientEvent[] = [];
  client.subscribe((event) => lastState.push(event));
  assert.ok(lastState[0]?.type === "connection" && lastState[0].state.status === "disconnected");

  current = originals.map((native, index) => ({ ...native, status: index === 0 ? "error" : "idle", activeTurn: null }));
  assert.equal(f.restore(page(), "native-0"), true, "the adapter must enable the SDK's public reconnect support");
  assert.equal(bridge.status().connected, true);
  assert.equal(host.external.state(mirrored).activity, null, "the actual terminal snapshot must settle activity through normal bridge events");
  assert.ok(observed.some((event) => event.type === "timeline" && event.message.type === "agent.timeline.subscription_restored"));
  const restored = observed.filter((event) => event.type === "agent_update").map((event) => event.type === "agent_update" && event.payload.kind === "upsert" ? event.payload.agent : null).filter(Boolean);
  assert.equal(restored.length, 13);
  for (const old of originals) assert.equal(restored.find((native) => native?.id === old.id)?.persistence?.sessionId, old.persistence.sessionId);
  assert.equal((await session.call("chats.list", {})).chats.filter((chat) => chat.id !== "main").length, 13);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).queue.length, 0);
  assert.equal(f.calls.filter((call) => call.method === "send").length, 1, "connection recovery must never replay the uncertain message");
  assert.equal(f.calls.filter((call) => call.method === "connect").length, 1, "the SDK restores the same driver, client identity and subscriptions");
  assert.equal(f.calls.filter((call) => call.method === "watch").length, 1, "restoration must not duplicate adapter timeline subscriptions");
  assert.ok(!f.calls.some((call) => ["createAgent", "cancel", "permission"].includes(call.method)));
  await release();
  await bridge.close();
  assert.equal(f.calls.filter((call) => call.method === "releaseWatch").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "releaseCatalog").length, 1);
  assert.deepEqual(f.calls.filter((call) => call.method === "setReconnectEnabled").map((call) => call.args[0]), [true, false]);
  assert.equal(f.restore(page()), false, "closing the adapter disables automatic reconnect");
});

test("close during a disconnect releases subscriptions and does not reconnect or send later", async (t) => {
  const f = await fixture(t);
  const client = await connectPaseo(f.config);
  await client.watch("a");
  f.disconnect();
  await client.close();
  assert.equal(f.restore(directory(["a"])), false);
  assert.equal(f.calls.filter((call) => call.method === "releaseWatch").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "releaseCatalog").length, 1);
  assert.ok(!f.calls.some((call) => ["send", "createAgent", "cancel", "permission"].includes(call.method)));
});

test("an unsupported SDK fails clearly and closes its connection instead of silently keeping a stale bridge", async (t) => {
  const f = await fixture(t);
  Reflect.deleteProperty(f.driver, "setReconnectEnabled");
  await assert.rejects(connectPaseo(f.config), /does not expose supported connection recovery/);
  assert.equal(f.calls.filter((call) => call.method === "close").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "observeAgents").length, 0);
});
