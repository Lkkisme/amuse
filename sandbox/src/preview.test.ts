import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { type Listening, serve } from "./daemon.ts";

let daemon: Listening;
let appPort: number;
const received: { path: string; headers: IncomingHttpHeaders }[] = [];
const app = createServer(async (req, res) => {
  if (req.url === "/stream") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: first\n\n"); setImmediate(() => res.end("data: last\n\n")); return; }
  if (req.url === "/redirect") { res.writeHead(302, { location: `http://127.0.0.1:${daemon.port}/run` }).end(); return; }
  let body = "";
  for await (const chunk of req) body += String(chunk);
  res.writeHead(201, { "content-type": "application/json", "x-preview-response": "fixture", "set-cookie": ["preview=kept; Path=/"] });
  res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }));
});
const socketApp = new WebSocketServer({ server: app });
socketApp.on("connection", (ws, req) => {
  received.push({ path: req.url ?? "", headers: req.headers });
  ws.on("message", (data, binary) => ws.send(data, { binary }));
});

before(async () => {
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address(); assert.ok(address && typeof address === "object"); appPort = address.port;
  const root = mkdtempSync(join(tmpdir(), "amuse-preview-"));
  const home = join(root, "home"); const workspace = join(home, "workspace"); const skeleton = join(root, "skeleton");
  mkdirSync(workspace, { recursive: true }); mkdirSync(skeleton);
  daemon = await serve({ home, workspace, skeleton, port: 0, host: "127.0.0.1" });
});
after(async () => {
  await daemon.close();
  for (const ws of socketApp.clients) ws.terminate();
  socketApp.close();
  app.closeAllConnections();
  await new Promise<void>((resolve) => app.close(() => resolve()));
});
const url = (path: string) => `http://127.0.0.1:${daemon.port}${path}`;

test("a browser can stream an app preview, preserving POST, headers, body, encoded path and query", async () => {
  const response = await fetch(url(`/preview/${appPort}/api/%E4%B8%AD%E6%96%87?a=one%20two&b=%2F`), {
    method: "POST", headers: { "content-type": "application/json", "x-fixture": "kept", origin: "http://sandbox:3000", "sec-fetch-site": "same-origin", cookie: "app=session" }, body: JSON.stringify({ text: "你好" }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-preview-response"), "fixture");
  assert.match(response.headers.get("set-cookie") ?? "", /preview=kept/);
  const result = await response.json() as { method: string; path: string; headers: IncomingHttpHeaders; body: string };
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/api/%E4%B8%AD%E6%96%87?a=one%20two&b=%2F");
  assert.equal(result.headers["x-fixture"], "kept");
  assert.equal(result.headers.host, `127.0.0.1:${appPort}`);
  assert.equal(result.headers.origin, "http://sandbox:3000");
  assert.equal(result.headers.cookie, "app=session");
  assert.deepEqual(JSON.parse(result.body), { text: "你好" });
  const streamed = await fetch(url(`/preview/${appPort}/stream`));
  assert.equal(streamed.headers.get("content-type"), "text/event-stream");
  assert.equal(await streamed.text(), "data: first\n\ndata: last\n\n");
  const root = await (await fetch(url(`/preview/${appPort}?root=yes`))).json() as { path: string };
  assert.equal(root.path, "/?root=yes");
});

test("preview redirects are returned to the browser instead of being followed into a control endpoint", async () => {
  const response = await fetch(url(`/preview/${appPort}/redirect`), { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `http://127.0.0.1:${daemon.port}/run`);
});

test("preview websocket relays text and binary frames, the path, Origin and chosen subprotocol", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/preview/${appPort}/socket?room=one%20two`, ["amuse-fixture"], { origin: "http://sandbox:3000" });
  try {
    await once(ws, "open");
    assert.equal(ws.protocol, "amuse-fixture");
    let reply = once(ws, "message"); ws.send("你好");
    const [text, binary] = await reply;
    assert.equal(String(text), "你好"); assert.equal(binary, false);
    reply = once(ws, "message"); ws.send(Buffer.from([0, 1, 2, 255]));
    const [data, isBinary] = await reply;
    assert.deepEqual(data, Buffer.from([0, 1, 2, 255])); assert.equal(isBinary, true);
    assert.equal(received.at(-1)?.path, "/socket?room=one%20two");
    assert.equal(received.at(-1)?.headers.origin, "http://sandbox:3000");
  } finally { ws.terminate(); }
});

test("invalid ports and both the default and actual control ports cannot be previewed", async () => {
  for (const port of ["0", "65536", "7070", String(daemon.port), "-1", "abc", "007070", "%37%30%37%30", "127.0.0.1:3000"]) {
    const response = await fetch(url(`/preview/${port}/run`), { method: "POST", headers: { origin: "http://sandbox:3000" }, body: "{}" });
    assert.equal(response.status, 400, port);
  }
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/preview/${daemon.port}/terminal`, { origin: "http://sandbox:3000" });
  const [error] = await once(ws, "error"); assert.match(String(error), /400/);
});

test("an unavailable preview app fails in words without changing the control route boundary", async () => {
  const response = await fetch(url("/preview/1/"), { headers: { origin: "http://sandbox:3000" } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "The preview app cannot be reached." });
});

test("browser access to all daemon control routes still receives 403", async () => {
  for (const path of ["/run", "/reset", "/secrets/env", "/secrets/file", "/secrets/type", "/secrets/forget"]) {
    const response = await fetch(url(path), { method: "POST", headers: { origin: "http://sandbox:3000" }, body: "{}" });
    assert.equal(response.status, 403, path);
  }
  assert.equal((await fetch(url("/health"), { headers: { "sec-fetch-site": "same-origin" } })).status, 403);
  assert.equal((await fetch(url("/health"))).status, 200, "the server's own health request still works");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/terminal`, { origin: "http://sandbox:3000" });
  const [error] = await once(ws, "error"); assert.match(String(error), /403/);
});
