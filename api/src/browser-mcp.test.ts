import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { BrowserMcpStepSchema, browserMcpTools, createBrowserMcp, type BrowserMcp, type BrowserMcpActions } from "./browser-mcp.ts";

function files(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-browser-mcp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { tokenPath: join(dir, "private", "browser-mcp.json") };
}
function actions() {
  const calls: { method: string; args: unknown[] }[] = [];
  let held = false;
  const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }); };
  const check = () => { if (held) throw new Error("The human controls this browser. Wait for hand-back."); };
  const api: BrowserMcpActions = {
    async open(chat, url) { check(); record("open", chat, url); return { id: "browser-1" }; },
    async list(chat) { record("list", chat); return [{ id: "browser-1", humanHeld: held }]; },
    async observe(chat, id) { record("observe", chat, id); return { url: "https://example.test/", title: "Synthetic page", text: "Fixture", elements: [{ ref: "e1", role: "button", label: "Continue" }] }; },
    async act(chat, id, step) { check(); record("act", chat, id, step); return { ok: true }; },
    async screenshot(chat, id) { record("screenshot", chat, id); return Uint8Array.from([137, 80, 78, 71]); },
    async finish(chat, id, result) { check(); record("finish", chat, id, result); },
  };
  return { api, calls, hold: () => { held = true; } };
}

test("browser capabilities persist per chat and malformed stores are never reset", async (t) => {
  const { tokenPath } = files(t);
  const f = actions();
  const one = createBrowserMcp({ actions: f.api, url: "http://127.0.0.1:8082/", tokenPath });
  const first = one.config("chat-a");
  assert.equal(first.amuse_browser.url, "http://127.0.0.1:8082/mcp/browser");
  assert.notEqual(first.amuse_browser.headers.Authorization, one.config("chat-b").amuse_browser.headers.Authorization);
  assert.deepEqual(one.config("chat-a"), first);
  await one.close();
  const two = createBrowserMcp({ actions: f.api, url: first.amuse_browser.url, tokenPath });
  assert.deepEqual(two.config("chat-a"), first);
  await two.close();
  assert.throws(() => two.config("chat-a"), /closed/);
  writeFileSync(tokenPath, "invalid fixture");
  assert.throws(() => createBrowserMcp({ actions: f.api, url: first.amuse_browser.url, tokenPath }), /not reset/);
  assert.equal(readFileSync(tokenPath, "utf8"), "invalid fixture");
});

test("step schemas accept observed refs and reject ambiguous or executable navigation", () => {
  assert.deepEqual(BrowserMcpStepSchema.parse({ kind: "click", ref: "e1" }), { kind: "click", ref: "e1" });
  assert.deepEqual(BrowserMcpStepSchema.parse({ kind: "type", ref: "e2", text: "hello", clear: true }), { kind: "type", ref: "e2", text: "hello", clear: true });
  assert.ok(BrowserMcpStepSchema.safeParse({ kind: "scroll", direction: "down" }).success);
  assert.ok(!BrowserMcpStepSchema.safeParse({ kind: "click", x: 1 }).success);
  assert.ok(!BrowserMcpStepSchema.safeParse({ kind: "scroll" }).success);
  assert.ok(!BrowserMcpStepSchema.safeParse({ kind: "navigate", url: "javascript:alert(1)" }).success);
  assert.ok(!BrowserMcpStepSchema.safeParse({ kind: "navigate", url: "file:///private" }).success);
});

async function httpFixture(t: TestContext, extra: Partial<BrowserMcpActions> = {}) {
  const { tokenPath } = files(t);
  const f = actions();
  let mcp: BrowserMcp | undefined;
  // An ephemeral in-process protocol fixture with fake actions; no browser or
  // production service is started by these tests.
  const http = createServer((req, res) => { void mcp!.handle(req, res).catch(() => { res.statusCode = 500; res.end(); }); });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  mcp = createBrowserMcp({ actions: { ...f.api, ...extra }, url: origin, tokenPath });
  const config = mcp.config("chat-a").amuse_browser;
  t.after(async () => {
    await mcp?.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { ...f, origin, config, mcp };
}

test("stateless SDK tools use the capability's chat, preserve screenshots and respect human hold", async (t) => {
  const f = await httpFixture(t);
  const client = new Client({ name: "synthetic-browser-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.config.url), { requestInit: { headers: f.config.headers } }) as Transport);
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["browser_act", "browser_finish", "browser_list", "browser_observe", "browser_open", "browser_screenshot"]);
  const opened = await client.callTool({ name: "browser_open", arguments: { url: "https://example.test/", chat: "chat-b" } });
  assert.equal(opened.isError, undefined);
  assert.deepEqual(f.calls.find((call) => call.method === "open")?.args, ["chat-a", "https://example.test/"]);
  await client.callTool({ name: "browser_act", arguments: { id: "browser-1", step: { kind: "click", ref: "e1" } } });
  assert.deepEqual(f.calls.find((call) => call.method === "act")?.args, ["chat-a", "browser-1", { kind: "click", ref: "e1" }]);
  const screenshot = await client.callTool({ name: "browser_screenshot", arguments: { id: "browser-1" } });
  assert.deepEqual(screenshot.content, [{ type: "image", data: Buffer.from([137, 80, 78, 71]).toString("base64"), mimeType: "image/png" }]);
  f.hold();
  const refused = await client.callTool({ name: "browser_act", arguments: { id: "browser-1", step: { kind: "press", key: "Enter" } } });
  assert.equal(refused.isError, true);
  const finish = await client.callTool({ name: "browser_finish", arguments: { id: "browser-1", result: "Done" } });
  assert.equal(finish.isError, true);
  assert.equal(f.calls.filter((call) => call.method === "act").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "finish").length, 0);
});

test("HTTP rejects missing capabilities and foreign origins without invoking actions", async (t) => {
  const f = await httpFixture(t);
  assert.equal((await fetch(f.config.url, { method: "POST", headers: { Cookie: "amuse=synthetic" } })).status, 401);
  assert.equal((await fetch(`${f.config.url}?token=synthetic`, { method: "POST" })).status, 401);
  assert.equal((await fetch(f.config.url, { method: "POST", headers: { ...f.config.headers, Origin: "https://foreign.test" } })).status, 403);
  assert.equal((await fetch(`${f.origin}/wrong`, { headers: f.config.headers })).status, 404);
  assert.equal(f.calls.length, 0);
});

test("optional browser upload and download tools retain schemas and bind the capability's scope", async (t) => {
  const uploads: unknown[][] = []; const downloads: unknown[][] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const f = await httpFixture(t, { upload: async (chat, id, ref, path, signal) => { uploads.push([chat, id, ref, path]); signals.push(signal); }, downloads: async (chat, id, signal) => { downloads.push([chat, id]); signals.push(signal); return [{ path: "downloads/fixture.txt" }]; } });
  const client = new Client({ name: "optional-browser-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.config.url), { requestInit: { headers: f.config.headers } }) as Transport);
  t.after(() => client.close());
  const listed = (await client.listTools()).tools;
  const upload = listed.find((tool) => tool.name === "browser_upload"); assert.ok(upload);
  assert.deepEqual(upload.inputSchema.required, ["id", "ref", "path"]);
  assert.ok(listed.some((tool) => tool.name === "browser_downloads"));
  const missing = await client.callTool({ name: "browser_upload", arguments: { id: "browser-1", ref: "e-file" } });
  assert.equal(missing.isError, true); assert.equal(uploads.length, 0);
  const invalid = await client.callTool({ name: "browser_upload", arguments: { id: "browser-1", ref: "e-file", path: 123 } });
  assert.equal(invalid.isError, true); assert.equal(uploads.length, 0);
  const uploaded = await client.callTool({ name: "browser_upload", arguments: { id: "browser-1", ref: "e-file", path: "user/fixture.txt", chat: "chat-b" } });
  assert.notEqual(uploaded.isError, true);
  assert.deepEqual(uploads, [["chat-a", "browser-1", "e-file", "user/fixture.txt"]]);
  const files = await client.callTool({ name: "browser_downloads", arguments: { id: "browser-1", chat: "chat-b" } });
  assert.notEqual(files.isError, true); assert.deepEqual(downloads, [["chat-a", "browser-1"]]);
  assert.match(JSON.stringify(files.content), /downloads\/fixture.txt/);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal), "SDK cancellation must reach the native upload/download operations");
});

test("codemode browser tools pass cancellation into the native operation and reject already stopped calls", async () => {
  const controller = new AbortController(); const received: (AbortSignal | undefined)[] = [];
  const f = actions();
  const tool = browserMcpTools({ ...f.api, act: async (_chat, _id, _step, signal) => { received.push(signal); return {}; } }, "chat-a").find((tool) => tool.name === "browser_act")!;
  const args = { id: "browser-1", step: { kind: "click", ref: "e1" } };
  await tool.execute("one", args, controller.signal);
  assert.equal(received[0], controller.signal);
  controller.abort();
  await assert.rejects(tool.execute("two", args, controller.signal), /abort/i);
  assert.equal(received.length, 1);
});
