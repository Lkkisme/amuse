import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHost, type Timers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import { type State, apply, empty } from "@remuse/protocol";
import { connect } from "./client.ts";
import { listen } from "./server.ts";

const token = "test-token";
/** Demo ports with no delays, so the scripted agent answers at once. */
const instant: Timers<number> = { set: (_, fn) => (queueMicrotask(fn), 0), clear: () => {} };

let base = "";
let close = () => {};
before(async () => {
  const server = await listen({ session: createHost(demoPorts(instant), { seed: seed() }), token, port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${server.port}/rpc`;
  close = () => void server.close();
});
after(() => close());

/** Raw socket: send one frame, return the first reply that is not an event. */
async function raw(frame: string): Promise<unknown> {
  const ws = new WebSocket(`${base}?token=${token}`);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const reply = new Promise<unknown>((resolve) =>
    ws.addEventListener("message", ({ data }) => {
      const msg: unknown = JSON.parse(String(data));
      if (typeof msg === "object" && msg !== null && !("method" in msg)) resolve(msg);
    }),
  );
  ws.send(frame);
  const result = await reply;
  ws.close();
  return result;
}

test("a wrong token is refused before the upgrade", async () => {
  const ws = new WebSocket(`${base}?token=nope`);
  const outcome = await new Promise((resolve) => {
    ws.addEventListener("open", () => resolve("open"));
    ws.addEventListener("error", () => resolve("refused"));
  });
  assert.equal(outcome, "refused");
});

test("bad frames get the JSON-RPC error they deserve", async () => {
  assert.deepEqual(await raw("{"), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  assert.deepEqual(await raw(JSON.stringify({ id: 1 })), { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  assert.deepEqual(await raw(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "nope", params: {} })), {
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32601, message: "Method not found" },
  });
  const invalid = await raw(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "chat.send", params: { text: "" } }));
  assert.ok(typeof invalid === "object" && invalid !== null && "error" in invalid);
  assert.deepEqual(await raw(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "browser.control", params: { id: "b-seed1", action: "handBack" } })), {
    jsonrpc: "2.0",
    id: 4,
    error: { code: -32000, message: "cannot handBack from completed" },
  });
});

test("the client syncs, sends, and folds the streamed events into the same state as the server", async () => {
  const session = connect(`${base}?token=${token}`);
  const synced = await session.call("session.sync", { since: null });
  assert.equal(synced.kind, "snapshot");
  let state: State = synced.kind === "snapshot" ? synced.state : empty;
  const done = new Promise<void>((resolve) =>
    session.subscribe((u) => {
      if (u.kind === "reset") return void (state = u.state);
      state = apply(state, u.envelope);
      if (u.envelope.event.kind === "activity" && u.envelope.event.activity === null) resolve();
    }),
  );
  const { id } = await session.call("chat.send", { text: "over the wire" });
  await done;
  assert.ok(state.entities.some((e) => e.id === id && e.kind === "prompt"));
  const last = state.entities.at(-1);
  assert.ok(last?.kind === "reply" && !last.streaming && last.text.includes("over the wire"));
  const server = await session.call("session.sync", { since: null });
  assert.ok(server.kind === "snapshot");
  assert.deepEqual(server.state, state);
  session.close();
});

test("a server that comes back without its log resets the client instead of freezing it", async () => {
  const first = await listen({ session: createHost(demoPorts(instant), { seed: seed() }), token, port: 0, host: "127.0.0.1" });
  const url = `ws://127.0.0.1:${first.port}/rpc?token=${token}`;
  const session = connect(url);
  const synced = await session.call("session.sync", { since: null });
  assert.ok(synced.kind === "snapshot" && synced.state.seq > 1);
  const reset = new Promise<number>((resolve) => session.subscribe((u) => (u.kind === "reset" ? resolve(u.state.seq) : undefined)));
  await first.close();
  // a fresh host with nothing in it, on the same port
  const second = await listen({ session: createHost(demoPorts(instant)), token, port: first.port, host: "127.0.0.1" });
  assert.equal(await reset, 0);
  session.close();
  await second.close();
});

test("unlock turns the token into an HttpOnly cookie that alone opens the socket", async () => {
  const http = base.replace("ws://", "http://").replace("/rpc", "");
  const offer = (t: string) => fetch(`${http}/unlock`, { method: "POST", body: JSON.stringify({ token: t }) });
  assert.equal((await offer("wrong")).status, 401);
  const unlocked = await offer(token);
  assert.equal(unlocked.status, 204);
  const cookie = unlocked.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const pair = cookie.split(";")[0] ?? "";
  assert.equal((await fetch(`${http}/unlock`)).status, 401);
  assert.equal((await fetch(`${http}/unlock`, { headers: { cookie: pair } })).status, 204);
  const { WebSocket: Ws } = await import("ws");
  const ws = new Ws(base, { headers: { cookie: pair } }); // no token in the URL
  const outcome = await new Promise((resolve) => {
    ws.on("open", () => resolve("open"));
    ws.on("error", () => resolve("refused"));
  });
  ws.close();
  assert.equal(outcome, "open");
});
