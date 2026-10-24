import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { type Browsers, nodeOrigin } from "@amuse/browser";
import { createHost, type Timers } from "@amuse/core";
import { demoPorts } from "@amuse/demo";
import { WebSocket, WebSocketServer } from "ws";
import { letIn, noPin } from "./testing.ts";
import type { Live } from "./live.ts";
import { listen } from "./server.ts";

const timers: Timers<number> = { set: () => 0, clear: () => {} };
const cookie = "amuse=viewer-test-session";
const access = letIn("viewer-test-session", (session) => session === "viewer-test-session");
const png = Uint8Array.from([137, 80, 78, 71]);

async function fixture(t: TestContext, options: { live?: boolean; native?: boolean; mcp?: boolean } = {}) {
  const backend = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(backend, "listening");
  const address = backend.address();
  assert.ok(address && typeof address !== "string");
  const target = `ws://127.0.0.1:${address.port}`;
  let remoteOrigin: string | undefined;
  backend.on("connection", (socket, request) => {
    remoteOrigin = request.headers.origin;
    socket.send(Buffer.from("rfb-frame"));
    socket.on("message", (data, binary) => socket.send(data, { binary }));
  });
  let held = false;
  const attached: string[] = [];
  const browsers: Browsers = {
    holds: (id) => ["native-run", "rfb-run"].includes(id),
    open: async () => {}, look: async () => ({ url: "https://example.com/", title: "Test", text: "", elements: [] }),
    step: async () => {}, screenshot: async (id) => ["native-run", "rfb-run"].includes(id) ? png : null,
    remember: async () => {}, fit: async () => {}, close: async () => {}, logins: async () => [], forgetLogin: async () => {},
    vnc: (id) => id === "rfb-run" ? target : null,
    upload: async () => {}, downloads: async () => [], stillOpen: async () => true,
  };
  const native = {
    owns: (id: string) => id === "native-run",
    info: async () => ({ transport: "native" as const, width: 1280, height: 720, cdpEndpoint: "must-not-be-exposed", privateToken: "must-not-be-exposed" }),
    attach(viewer: WebSocket, id: string, controlled: () => boolean) {
      attached.push(id);
      viewer.send(JSON.stringify({ type: "ready", held: controlled() }));
      viewer.on("message", () => viewer.send(JSON.stringify({ held: controlled() })));
    },
  };
  const live: Live = { browsers, controlled: () => held, ...(options.native === false ? {} : { native }) };
  let mcpCalls = 0;
  const server = await listen({
    session: createHost(demoPorts(timers), { timers }), access, ...noPin, port: 0, host: "127.0.0.1",
    ...(options.live === false ? {} : { live }),
    ...(options.mcp ? { browserMcp: async (request, response) => {
      mcpCalls++;
      response.writeHead(request.headers.authorization === "Bearer scope-test" ? 204 : 401).end();
    } } : {}),
  });
  t.after(async () => {
    await server.close();
    for (const socket of backend.clients) socket.terminate();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  });
  const http = `http://127.0.0.1:${server.port}`;
  return { http, ws: `ws://127.0.0.1:${server.port}`, attached, hold: (value: boolean) => { held = value; }, origin: () => remoteOrigin, mcpCalls: () => mcpCalls };
}

test("browser-view metadata requires the session cookie and same origin and returns only public dimensions", async (t) => {
  const { http } = await fixture(t);
  assert.equal((await fetch(`${http}/browser-view?id=native-run`)).status, 401);
  assert.equal((await fetch(`${http}/browser-view?id=native-run`, { headers: { cookie, origin: "https://other.example" } })).status, 403);
  const response = await fetch(`${http}/browser-view?id=native-run`, { headers: { cookie, origin: http } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { transport: "native", width: 1280, height: 720 });
  assert.equal((await fetch(`${http}/browser-view?id=native-run`, { method: "POST", headers: { cookie, origin: http } })).status, 405);
  assert.equal((await fetch(`${http}/browser-view?id=missing`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${http}/browser-view`, { headers: { cookie } })).status, 404);
});

test("browser-view returns RFB metadata for an existing legacy run and 404 when no live backend is configured", async (t) => {
  const { http } = await fixture(t, { native: false });
  const response = await fetch(`${http}/browser-view?id=rfb-run`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { transport: "rfb" });
  const absent = await fixture(t, { live: false });
  assert.equal((await fetch(`${absent.http}/browser-view?id=rfb-run`, { headers: { cookie } })).status, 404);
});

test("the authenticated live route dispatches native viewers and reevaluates current takeover state", async (t) => {
  const fixtureState = await fixture(t);
  const viewer = new WebSocket(`${fixtureState.ws}/live?id=native-run`, { headers: { cookie, origin: fixtureState.http } });
  const first = once(viewer, "message");
  await once(viewer, "open");
  const [data] = await first;
  assert.deepEqual(JSON.parse(String(data)), { type: "ready", held: false });
  assert.deepEqual(fixtureState.attached, ["native-run"]);
  fixtureState.hold(true);
  const second = once(viewer, "message"); viewer.send("check-current-control");
  const [updated] = await second;
  assert.deepEqual(JSON.parse(String(updated)), { held: true });
  const closed = once(viewer, "close"); viewer.close(); await closed;
});

test("unauthenticated and foreign-origin websocket viewers cannot reach the native attach handler", async (t) => {
  const { ws, http, attached } = await fixture(t);
  const rejected = (headers: Record<string, string>) => new Promise<number | undefined>((resolve, reject) => {
    const viewer = new WebSocket(`${ws}/live?id=native-run`, { headers });
    viewer.on("error", () => {});
    viewer.once("open", () => { viewer.terminate(); reject(new Error("an unauthorized live viewer was accepted")); });
    viewer.once("unexpected-response", (_, response) => { response.resume(); viewer.terminate(); resolve(response.statusCode); });
  });
  assert.equal(await rejected({ origin: http }), 401);
  assert.equal(await rejected({ cookie, origin: "https://other.example" }), 401);
  assert.deepEqual(attached, []);
});

test("legacy binary RFB live frames still relay and browser thumbnails remain PNG", async (t) => {
  const fixtureState = await fixture(t);
  const viewer = new WebSocket(`${fixtureState.ws}/live?id=rfb-run`, ["binary"], { headers: { cookie, origin: fixtureState.http } });
  const first = once(viewer, "message"); await once(viewer, "open");
  const [frame, binary] = await first;
  assert.equal(String(frame), "rfb-frame"); assert.equal(binary, true);
  assert.equal(viewer.protocol, "binary");
  assert.equal(fixtureState.origin(), nodeOrigin);
  assert.deepEqual(fixtureState.attached, []);
  const closed = once(viewer, "close"); viewer.close(); await closed;
  const response = await fetch(`${fixtureState.http}/thumb?id=native-run`, { headers: { cookie } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
});

test("only the scoped browser MCP route delegates bearer authentication without requiring a browser cookie", async (t) => {
  const state = await fixture(t, { mcp: true });
  assert.equal((await fetch(`${state.http}/mcp/browser`, { method: "POST", headers: { authorization: "Bearer scope-test" } })).status, 204);
  assert.equal((await fetch(`${state.http}/mcp/browser`, { method: "POST" })).status, 401);
  assert.equal(state.mcpCalls(), 2);
  assert.equal((await fetch(`${state.http}/mcp/browser`, { headers: { authorization: "Bearer scope-test", origin: "https://foreign.example" } })).status, 403);
  assert.equal(state.mcpCalls(), 2, "a foreign-origin request never reaches the bearer handler");
  assert.equal((await fetch(`${state.http}/unlock`, { headers: { authorization: "Bearer scope-test" } })).status, 401, "a browser-MCP bearer cannot authenticate other app routes");
  assert.equal((await fetch(`${state.http}/browser-view?id=native-run`, { headers: { authorization: "Bearer scope-test" } })).status, 401);
  const absent = await fixture(t);
  assert.equal((await fetch(`${absent.http}/mcp/browser`, { method: "POST" })).status, 404);
});
