import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHost, type Timers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import { type Envelope, type State, apply, empty } from "@remuse/protocol";
import { connect } from "./client.ts";
import { listen } from "./server.ts";

const token = "test-token";
/** Demo ports with no delays, so the scripted agent answers at once. */
const instant: Timers<number> = { set: (_, fn) => (queueMicrotask(fn), 0), clear: () => {} };

let base = "";
let close = () => {};
before(async () => {
  const server = await listen({ session: createHost(demoPorts(instant), { seed: seed() }), token, port: 0, host: "127.0.0.1" });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server is listening on TCP");
  base = `ws://127.0.0.1:${address.port}/rpc`;
  close = () => server.close();
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
    session.subscribe((e: Envelope) => {
      state = apply(state, e);
      if (e.event.kind === "activity" && e.event.activity === null) resolve();
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
