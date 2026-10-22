import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { browserCliToken, parseBrowserCli, runBrowserCli, withoutBrowserCredential } from "./browser-cli.ts";
import { createBrowserMcp } from "./browser-mcp.ts";

function temporary(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "amuse-browser-cli-test-"));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}amuse-browser-cli-test-`));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("browser CLI maps every command and reads action JSON from an absolute file", () => {
  const prefix = ["--chat", "c-one"];
  assert.deepEqual(parseBrowserCli([...prefix, "open", "https://example.com"]), { chat: "c-one", name: "browser_open", arguments: { url: "https://example.com/" } });
  assert.equal(parseBrowserCli([...prefix, "list"]).name, "browser_list");
  assert.deepEqual(parseBrowserCli([...prefix, "observe", "b-one"]).arguments, { id: "b-one" });
  assert.equal(parseBrowserCli([...prefix, "screenshot", "b-one"]).name, "browser_screenshot");
  assert.deepEqual(parseBrowserCli([...prefix, "finish", "b-one", "已经完成", "并验证"]).arguments, { id: "b-one", result: "已经完成 并验证" });
  const file = join(tmpdir(), "step.json");
  let readPath = "";
  assert.deepEqual(parseBrowserCli([...prefix, "act", "b-one", "--json-file", file], (path) => { readPath = path; return '{"kind":"type","text":"中文输入"}'; }).arguments,
    { id: "b-one", step: { kind: "type", text: "中文输入" } });
  assert.equal(readPath, file);
  assert.deepEqual(parseBrowserCli([...prefix, "act", "b-one", '{"kind":"press","key":"Enter"}']).arguments, { id: "b-one", step: { kind: "press", key: "Enter" } });
});

test("browser CLI rejects ambiguous or invalid arguments before reading credentials", () => {
  for (const args of [[], ["list"], ["--chat", "c-one", "--chat", "c-two", "list"], ["--chat", "c-one", "open", "file:///secret"], ["--chat", "c-one", "act", "b-one", "--json-file", "relative.json"], ["--chat", "c-one", "act", "b-one", "{}"], ["--chat", "c-one", "act", "b-one", "not-json"]])
    assert.throws(() => parseBrowserCli(args));
});

test("missing or invalid chat capabilities never leak file contents and are never created by the CLI", async (t) => {
  const directory = temporary(t);
  const local = join(directory, ".local"); mkdirSync(local);
  const path = join(local, "browser-mcp.json");
  const secret = "s".repeat(43);
  writeFileSync(path, JSON.stringify({ version: 1, tokens: { "different-chat": secret } }));
  const original = readFileSync(path, "utf8");
  await assert.rejects(runBrowserCli(["--chat", "missing-chat", "list"], { root: directory, write: () => assert.fail("there must be no credential output") }), (error: Error) => !error.message.includes(secret) && error.message.includes("初始化"));
  assert.equal(readFileSync(path, "utf8"), original);
  writeFileSync(path, `invalid-json-${secret}`);
  assert.throws(() => browserCliToken(path, "missing-chat"), (error: Error) => !error.message.includes(secret));
  assert.equal(withoutBrowserCredential(`endpoint returned ${secret} or Bearer ${secret}`, secret).includes(secret), false);
});

test("browser CLI uses the real MCP HTTP transport, redacts token echoes and saves screenshots without base64 output", async (t) => {
  const directory = temporary(t);
  const tokenPath = join(directory, ".local", "browser-mcp.json");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzS8AAAAASUVORK5CYII=", "base64");
  let token = "";
  const mcp = createBrowserMcp({ url: "http://127.0.0.1", tokenPath, actions: {
    open: async () => ({ id: "b-one" }), list: async () => ({ browsers: ["b-one"], echo: token }), observe: async () => ({ text: "test page" }),
    act: async () => ({ ok: true }), screenshot: async () => png, finish: async () => {},
  } });
  mcp.config("c-one"); token = browserCliToken(tokenPath, "c-one");
  const server = createServer((request, response) => { void mcp.handle(request, response); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  t.after(async () => { await mcp.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const endpoint = `http://127.0.0.1:${address.port}/mcp/browser`;
  const output: string[] = [];
  const options = { root: directory, endpoint, write: (text: string) => { output.push(text); } };
  assert.equal(await runBrowserCli(["--chat", "c-one", "list"], options), 0);
  assert.match(output.join("\n"), /b-one/); assert.equal(output.join("\n").includes(token), false);
  output.length = 0;
  assert.equal(await runBrowserCli(["--chat", "c-one", "screenshot", "b-one"], options), 0);
  const result = JSON.parse(output[0]!) as { path: string; mimeType: string };
  assert.equal(result.mimeType, "image/png");
  assert.match(result.path, /observations[\\/][a-f0-9]{64}\.png$/);
  assert.deepEqual(readFileSync(result.path), png);
  assert.equal(output.join("\n").includes(png.toString("base64")), false);
  assert.equal(output.join("\n").includes(token), false);
});
