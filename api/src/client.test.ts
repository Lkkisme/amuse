import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { empty, type BackendStatus, type Method, type Params, type Update } from "@amuse/protocol";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { z } from "zod";
import { CallFailed, Dropped, connect } from "./client.ts";

class Socket {
  static CONNECTING = 0;
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 0;
  sent: { id: number; method: string; params: unknown }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) { Socket.all.push(this); }
  send(frame: string) { this.sent.push(JSON.parse(frame)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); }
  lose(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  reply(result: unknown, request = this.sent.at(-1)) {
    assert.ok(request);
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) });
  }
}

function fixture(t: TestContext) {
  Socket.all = [];
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const nav = { onLine: true };
  for (const [name, value] of Object.entries({ WebSocket: Socket, window: win, document: doc, navigator: nav })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : Reflect.deleteProperty(globalThis, name));
  }
  const session = connect("wss://fixture.invalid/rpc");
  t.after(() => session.close());
  return { session, win, doc, nav, event: (name: string) => win.dispatchEvent(new Event(name)) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const backend: BackendStatus = {
  kind: "paseo", connected: false, label: "Isolated fixture", detail: "Directory is slow; API is responding.",
  model: null, contextWindow: null, capabilities: [],
};

test("a slow Paseo directory does not disconnect an API that answers the lightweight probe", async (t) => {
  const f = fixture(t);
  const ws = Socket.all[0]!; ws.open();
  const updates: Update[] = [];
  f.session.subscribe((update) => updates.push(update));
  f.event("amuse:network-change");
  const status = ws.sent.find((request) => request.method === "backend.status");
  if (status) ws.reply(backend, status);
  await flush();
  // Paseo can take longer than the transport deadline, while the API itself is healthy.
  t.mock.timers.tick(6_000); await flush();
  assert.equal(ws.readyState, Socket.OPEN, "a slow directory is not a dead transport");
  assert.equal(Socket.all.length, 1);
  const directory = ws.sent.filter((request) => request.method === "chats.list");
  assert.equal(directory.length, 1);
  f.event("amuse:resume");
  ws.reply(backend, ws.sent.findLast((request) => request.method === "backend.status"));
  await flush();
  assert.equal(ws.sent.filter((request) => request.method === "chats.list").length, 1, "a pending directory refresh is shared");
  const list = [{ id: "new-chat", title: "New chat while phone was away", at: "2026-10-25T00:00:00Z", updated: "2026-10-25T00:00:00Z" }];
  ws.reply({ chats: list }, directory[0]); await flush();
  assert.deepEqual(updates, [{ kind: "chats", chats: list }], "late successful reads still refresh chats and wake dropped settings reads");
});

test("resume/online probe one healthy socket without reloading or duplicating reconnects", async (t) => {
  const f = fixture(t);
  const ws = Socket.all[0]!; ws.open();
  f.event("amuse:resume"); f.event("amuse:network-change"); f.event("online"); f.event("pageshow");
  assert.deepEqual(ws.sent.map((x) => x.method), ["backend.status"]);
  ws.reply(backend); await flush();
  assert.deepEqual(ws.sent.map((x) => x.method), ["backend.status", "chats.list"]);
  ws.reply({ chats: [] }); await flush();
  t.mock.timers.tick(5_000);
  assert.equal(Socket.all.length, 1);
  f.event("amuse:pause");
  t.mock.timers.tick(60_000);
  assert.equal(ws.sent.length, 2, "no background heartbeat");
  f.event("amuse:resume");
  assert.equal(ws.sent.length, 3);
  ws.reply(backend); await flush();
  ws.reply({ chats: [] }); await flush();
  f.session.close(); t.mock.timers.tick(60_000); f.event("online");
  assert.equal(Socket.all.length, 1, "disposed listeners and timers cannot reopen a socket");
});

test("a silent socket after radio change fails uncertain writes and restores only read subscriptions", async (t) => {
  const f = fixture(t);
  const first = Socket.all[0]!; first.open();
  for (const chat of ["one", "two"]) {
    const sync = f.session.call("session.sync", { chat, since: null });
    first.reply({ kind: "snapshot", state: { ...empty, seq: 7 } }); await sync;
  }
  const sent = f.session.call("chat.send", { chat: "one", text: "only once", attachments: [], timezone: "UTC" });
  const failed = assert.rejects(sent, /disconnected/);
  const updates: Update[] = [];
  f.session.subscribe((update) => updates.push(update));
  f.event("amuse:network-change");
  assert.equal(first.sent.at(-1)?.method, "backend.status");
  t.mock.timers.tick(4_999); await flush();
  assert.equal(first.readyState, Socket.OPEN);
  t.mock.timers.tick(1); await flush(); await failed;
  assert.equal(first.readyState, 3, "an unanswered lightweight probe still expires at five seconds");
  await assert.rejects(f.session.call("chat.stop", { chat: "one" }), /disconnected/);
  t.mock.timers.tick(500);
  const second = Socket.all[1]!; second.open();
  assert.deepEqual(second.sent.map((x) => x.method), ["chats.list", "session.sync", "session.sync"]);
  assert.deepEqual(second.sent.slice(1).map((x) => x.params), [{ chat: "one", since: 7 }, { chat: "two", since: 7 }]);
  assert.equal(first.sent.filter((x) => x.method === "chat.send").length, 1);
  assert.equal(second.sent.some((x) => x.method === "chat.send" || x.method === "chat.stop"), false);
  const list = [{ id: "new-chat", title: "Appeared during outage", at: "2026-10-25T00:00:00Z", updated: "2026-10-25T00:00:00Z" }];
  second.reply({ chats: list }, second.sent[0]); await flush();
  assert.deepEqual(updates, [{ kind: "chats", chats: list }], "the replacement connection still publishes a fresh catalog");
});

test("background cancels retry, foreground wakes it once, and auth/protocol failures stay terminal", async (t) => {
  const f = fixture(t);
  Socket.all[0]!.open(); Socket.all[0]!.lose();
  f.doc.visibilityState = "hidden"; f.doc.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(60_000); f.event("amuse:network-change");
  assert.equal(Socket.all.length, 1);
  f.doc.visibilityState = "visible"; f.doc.dispatchEvent(new Event("visibilitychange")); f.event("amuse:resume");
  t.mock.timers.tick(0);
  assert.equal(Socket.all.length, 2);
  Socket.all[1]!.open(); Socket.all[1]!.lose(4403);
  f.event("online"); f.event("amuse:resume"); t.mock.timers.tick(60_000);
  assert.equal(Socket.all.length, 2);
  await assert.rejects(f.session.call("chats.list", {}), /disconnected/);
});

test("a cancelled background probe cannot cancel a newer probe or leak pending health calls", async (t) => {
  const f = fixture(t);
  const ws = Socket.all[0]!; ws.open();
  f.event("amuse:resume"); const stale = ws.sent[0]!;
  f.event("amuse:pause"); f.event("amuse:resume"); await flush();
  ws.reply(backend, stale); await flush();
  t.mock.timers.tick(5_000); await flush();
  assert.equal(ws.readyState, 3, "the new unanswered probe still expires");
  f.session.close(); t.mock.timers.tick(60_000);
  assert.equal(Socket.all.length, 1);
});

test("a lost catalog refresh is replaced once and stale answers cannot overwrite the new catalog", async (t) => {
  const f = fixture(t);
  const first = Socket.all[0]!; first.open();
  const updates: Update[] = [];
  f.session.subscribe((update) => updates.push(update));
  f.event("amuse:resume"); first.reply(backend); await flush();
  const stale = first.sent.at(-1)!;
  assert.equal(stale.method, "chats.list");
  first.lose(); await flush();
  t.mock.timers.tick(500);
  const second = Socket.all[1]!; second.open(); await flush();
  assert.deepEqual(second.sent.map((request) => request.method), ["chats.list"], "the old internal read is not replayed alongside the replacement");
  first.reply({ chats: [{ id: "stale", title: "Stale", at: "2026-10-25T00:00:00Z", updated: "2026-10-25T00:00:00Z" }] }, stale);
  second.reply({ chats: [] }); await flush();
  assert.deepEqual(updates, [{ kind: "chats", chats: [] }]);
});

test("a malformed health result stays a terminal protocol failure", async (t) => {
  const f = fixture(t);
  const ws = Socket.all[0]!; ws.open();
  f.event("amuse:resume");
  ws.reply({ chats: [] }); await flush();
  assert.equal(ws.readyState, 3);
  f.event("amuse:resume"); f.event("online"); t.mock.timers.tick(60_000);
  assert.equal(Socket.all.length, 1, "a protocol error is never hidden by reconnecting");
});

test("a failed first handshake retries only its requested read, never its queued write", async (t) => {
  const f = fixture(t);
  const initialRead = f.session.call("session.sync", { chat: "initial", since: null });
  const initialWrite = assert.rejects(f.session.call("chat.send", { chat: "initial", text: "do not retry", timezone: "UTC", attachments: [] }), /disconnected/);
  Socket.all[0]!.lose(); await flush(); await initialWrite;
  const second = Socket.all[1]!; second.open(); await flush();
  assert.deepEqual(second.sent.map((x) => x.method), ["chats.list", "session.sync"]);
  assert.deepEqual(second.sent[1]!.params, { chat: "initial", since: null });
  second.reply({ kind: "snapshot", state: empty });
  assert.deepEqual(await initialRead, { kind: "snapshot", state: empty });
});

const Asked = z.object({ id: z.number().optional(), method: z.string().optional() });

/** A server that answers every call, unless told to keep quiet (so a call is left in flight), and can drop anyone. */
async function server() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  const sockets = new Set<ServerSocket>();
  let quiet = false;
  let connections = 0;
  const asks: string[] = [];
  let holdDirectory = false;
  const heldDirectory: { ws: ServerSocket; id: number }[] = [];
  wss.on("connection", (ws) => {
    connections++;
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (data) => {
      const asked = Asked.parse(JSON.parse(data.toString()));
      if (asked.method) asks.push(asked.method);
      if (quiet || asked.id === undefined) return;
      if (holdDirectory && asked.method === "chats.list") { heldDirectory.push({ ws, id: asked.id }); return; }
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: asked.id, result: asked.method === "backend.status" ? backend : asked.method === "chats.list" ? { chats: [] } : { accounts: [] } }));
    });
  });
  const address = wss.address();
  return {
    url: `ws://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/rpc`,
    connections: () => connections,
    asks,
    quiet: (on: boolean) => void (quiet = on),
    holdDirectory: () => { holdDirectory = true; },
    releaseDirectory: () => {
      holdDirectory = false;
      for (const { ws, id } of heldDirectory.splice(0)) ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: { chats: [] } }));
    },
    /** the socket goes, as it does when the browser freezes the page */
    drop: () => sockets.forEach((ws) => ws.terminate()),
    close: () => new Promise((resolve) => wss.close(() => resolve(undefined))),
  };
}

test("real WebSocket keeps working past five seconds of directory delay and later publishes its result", { timeout: 15_000 }, async () => {
  const win = new EventTarget();
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  const at = await server();
  const session = connect(at.url);
  const updates: Update[] = [];
  session.subscribe((update) => updates.push(update));
  try {
    await session.call("apps.accounts", {});
    at.holdDirectory();
    win.dispatchEvent(new Event("amuse:network-change"));
    assert.deepEqual(await session.call("backend.status", {}), backend);
    await new Promise((resolve) => setTimeout(resolve, 5_300));
    assert.equal(at.connections(), 1, "API is alive even though Paseo discovery exceeds the health deadline");
    assert.deepEqual(await session.call("apps.accounts", {}), { accounts: [] });
    assert.equal(at.asks.filter((method) => method === "chats.list").length, 1);
    const changed = new Promise<void>((resolve) => {
      const remove = session.subscribe((update) => { if (update.kind === "chats") { remove(); resolve(); } });
    });
    at.releaseDirectory();
    await changed;
    assert.deepEqual(updates, [{ kind: "chats", chats: [] }]);
  } finally {
    session.close();
    await at.close();
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a call the dropped socket was carrying fails as Dropped; resume() puts the next one through", async () => {
  const at = await server();
  const session = connect(at.url);
  try {
    assert.deepEqual(await session.call("apps.accounts", {}), { accounts: [] });

    // one in flight when the socket goes: it is not answered, and says so as a drop (not as "disconnected")
    at.quiet(true);
    const lost = session.call("chats.create", {});
    at.drop();
    await assert.rejects(lost, (e: unknown) => e instanceof Dropped);

    // the page comes back: resume() takes it up now, and the next call goes over the socket that is up
    at.quiet(false);
    session.resume();
    assert.deepEqual(await session.call("apps.accounts", {}), { accounts: [] });
  } finally {
    session.close();
    await at.close();
  }
});

test("resume() leaves a connection that is up alone", async () => {
  const at = await server();
  const session = connect(at.url);
  try {
    await session.call("apps.accounts", {});
    const opened = at.connections();
    session.resume();
    await session.call("apps.accounts", {});
    assert.equal(at.connections(), opened, "no second socket was opened");
  } finally {
    session.close();
    await at.close();
  }
});

test("a repeatable call lost to a drop waits for the reconnect and is sent once more, and the page never sees the drop", async () => {
  const at = await server();
  const session = connect(at.url);
  try {
    await session.call("apps.accounts", {});
    at.asks.length = 0;

    at.quiet(true);
    const lost = session.call("apps.accounts", {});
    await new Promise((resolve) => setTimeout(resolve, 50)); // it reached the server, which did not answer
    at.quiet(false);
    at.drop();
    assert.deepEqual(await lost, { accounts: [] });
    assert.deepEqual(at.asks.filter((method) => method !== "chats.list"), ["apps.accounts", "apps.accounts"], "sent again once, after the reconnect");
  } finally {
    session.close();
    await at.close();
  }
});

test("a call that must not go twice says the server cannot be reached, in the user's words, and is not sent again", async () => {
  const at = await server();
  const session = connect(at.url, { unreachable: () => "无法连接服务器。" });
  try {
    await session.call("apps.accounts", {});
    at.asks.length = 0;

    at.quiet(true);
    const lost = session.call("chats.create", {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    at.drop();
    await assert.rejects(lost, (e: unknown) => e instanceof Dropped && e.message === "无法连接服务器。");

    at.quiet(false);
    session.resume();
    await session.call("apps.accounts", {});
    assert.deepEqual(at.asks.filter((method) => method !== "chats.list"), ["chats.create", "apps.accounts"], "chats.create went once");
  } finally {
    session.close();
    await at.close();
  }
});

test("a repeatable call gives up in the user's words when no reconnect comes in time", async () => {
  const at = await server();
  const session = connect(at.url, { unreachable: () => "无法连接服务器。", patience: 100 });
  try {
    await session.call("apps.accounts", {});
    at.quiet(true);
    const lost = session.call("apps.accounts", {});
    const closing = at.close(); // the server is gone for good: no one can connect again
    at.drop();
    await closing;
    await assert.rejects(lost, (e: unknown) => e instanceof Dropped && e.message === "无法连接服务器。");
  } finally {
    session.close();
  }
});

test("uncertain browser, tool approval, model and secret mutations are never replayed", async (t) => {
  const f = fixture(t);
  const first = Socket.all[0]!; first.open();
  const mutations: [Method, Record<string, unknown>][] = [
    ["chat.send", { chat: "one", text: "once", attachments: [], timezone: "UTC" }],
    ["approval.resolve", { id: "card", resolution: "allow" }],
    ["browser.control", { id: "browser", action: "take" }],
    ["secrets.setSecret", { id: "entry", field: "token", value: "test" }],
    ["models.choose", { role: "chat", model: "unchanged" }],
  ];
  const lost = mutations.map(([method, params]) => assert.rejects(f.session.call(method, params as Params[Method]), Dropped));
  first.lose(); await Promise.all(lost); await flush();
  t.mock.timers.tick(500); const second = Socket.all[1]!; second.open();
  assert.deepEqual(second.sent.map((request) => request.method), ["chats.list"]);
  assert.equal(first.sent.length, mutations.length);
});

test("a PIN refusal retains its RPC code and is never transport-retried", async (t) => {
  const f = fixture(t); const ws = Socket.all[0]!; ws.open();
  const called = f.session.call("secrets.list", {});
  const request = ws.sent.at(-1)!;
  ws.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32001, message: "PIN required" } }) });
  await assert.rejects(called, (error: unknown) => error instanceof CallFailed && error.code === -32001 && error.message === "PIN required");
  assert.equal(ws.sent.length, 1);
});

test("a rejected command keeps its structured reason without changing transport recovery", async (t) => {
  const f = fixture(t); const ws = Socket.all[0]!; ws.open();
  const called = f.session.call("schedule.control", { id: "gone-schedule", action: "cancel" });
  const request = ws.sent.at(-1)!;
  const rejection = { kind: "notFound", entity: "schedule", id: "gone-schedule" };
  ws.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Rejected", data: rejection } }) });
  await assert.rejects(called, (error: unknown) => error instanceof CallFailed && error.code === -32000 && JSON.stringify(error.data) === JSON.stringify(rejection));
  assert.equal(ws.sent.length, 1);
  assert.equal(ws.readyState, Socket.OPEN);
});

test("closing a session rejects a read waiting for recovery and cancels its deadline", async (t) => {
  const f = fixture(t); Socket.all[0]!.open(); Socket.all[0]!.lose();
  const waiting = assert.rejects(f.session.call("apps.accounts", {}), Dropped);
  await flush(); f.session.close(); await waiting;
  const count = Socket.all.length; t.mock.timers.tick(60_000); f.event("online");
  assert.equal(Socket.all.length, count);
});
