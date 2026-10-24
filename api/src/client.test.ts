import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { empty } from "@amuse/protocol";
import { connect } from "./client.ts";

class Socket {
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

test("resume/online probe one healthy socket without reloading or duplicating reconnects", async (t) => {
  const f = fixture(t);
  const ws = Socket.all[0]!; ws.open();
  f.event("amuse:resume"); f.event("amuse:network-change"); f.event("online"); f.event("pageshow");
  assert.deepEqual(ws.sent.map((x) => x.method), ["chats.list"]);
  ws.reply({ chats: [] }); await flush();
  t.mock.timers.tick(5_000);
  assert.equal(Socket.all.length, 1);
  f.event("amuse:pause");
  t.mock.timers.tick(60_000);
  assert.equal(ws.sent.length, 1, "no background heartbeat");
  f.event("amuse:resume");
  assert.equal(ws.sent.length, 2);
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
  f.event("amuse:network-change");
  t.mock.timers.tick(5_000); await flush(); await failed;
  await assert.rejects(f.session.call("chat.stop", { chat: "one" }), /disconnected/);
  t.mock.timers.tick(500);
  const second = Socket.all[1]!; second.open();
  assert.deepEqual(second.sent.map((x) => x.method), ["chats.list", "session.sync", "session.sync"]);
  assert.deepEqual(second.sent.slice(1).map((x) => x.params), [{ chat: "one", since: 7 }, { chat: "two", since: 7 }]);
  assert.equal(first.sent.filter((x) => x.method === "chat.send").length, 1);
  assert.equal(second.sent.some((x) => x.method === "chat.send" || x.method === "chat.stop"), false);
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
  ws.reply({ chats: [] }, stale); await flush();
  t.mock.timers.tick(5_000); await flush();
  assert.equal(ws.readyState, 3, "the new unanswered probe still expires");
  f.session.close(); t.mock.timers.tick(60_000);
  assert.equal(Socket.all.length, 1);
});

test("a failed first handshake restores the requested chat snapshot, never its queued write", async (t) => {
  const f = fixture(t);
  const initialRead = assert.rejects(f.session.call("session.sync", { chat: "initial", since: null }), /disconnected/);
  const initialWrite = assert.rejects(f.session.call("chat.send", { chat: "initial", text: "do not retry", timezone: "UTC", attachments: [] }), /disconnected/);
  Socket.all[0]!.lose(); await initialRead; await initialWrite;
  t.mock.timers.tick(500); Socket.all[1]!.open();
  assert.deepEqual(Socket.all[1]!.sent.map((x) => x.method), ["chats.list", "session.sync"]);
  assert.deepEqual(Socket.all[1]!.sent[1]!.params, { chat: "initial", since: null });
  let reset = false;
  f.session.subscribe((update) => { if (update.kind === "reset" && update.chat === "initial") reset = true; });
  Socket.all[1]!.reply({ kind: "snapshot", state: empty }); await flush();
  assert.equal(reset, true, "the visible chat receives the recovered initial state");
});
