import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { type Frame, pool, replay, watch } from "./index.ts";

const html = `<!doctype html><title>Form</title><body style="margin:0">
<input id="q" style="position:absolute;left:0;top:0;width:1280px;height:100px;font-size:40px"></body>`;
const server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address !== null && typeof address === "object");
const url = `http://127.0.0.1:${address.port}/`;
const browsers = pool();
after(async () => {
  await browsers.shutdown();
  server.close();
});

test("a run's page streams JPEG frames and reports its screen", async () => {
  const page = await browsers.open("b1", url);
  const frames: Frame[] = [];
  const stop = await watch(page, (f) => frames.push(f));
  await page.evaluate(() => document.body.append("change"));
  for (let i = 0; i < 50 && !frames.some((f) => f.kind === "frame"); i++) await new Promise((r) => setTimeout(r, 100));
  await stop();
  const screen = frames.find((f) => f.kind === "screen");
  assert.deepEqual(screen, { kind: "screen", width: 1280, height: 800, url, title: "Form" });
  const frame = frames.find((f) => f.kind === "frame");
  assert.ok(frame?.kind === "frame" && frame.jpeg[0] === 0xff && frame.jpeg[1] === 0xd8, "a JPEG frame arrived");
});

test("user input lands in the page: click by fraction, then type", async () => {
  const page = await browsers.open("b2", url);
  await replay(page, { kind: "pointer", action: "down", x: 0.5, y: 0.05, button: "left" });
  await replay(page, { kind: "pointer", action: "up", x: 0.5, y: 0.05, button: "left" });
  await replay(page, { kind: "text", text: "tide" });
  await replay(page, { kind: "key", action: "down", key: "s" });
  await replay(page, { kind: "key", action: "up", key: "s" });
  assert.equal(await page.inputValue("#q"), "tides");
  await browsers.close("b2");
  assert.equal(browsers.page("b2"), undefined);
});

test("logins carry over: a saved cookie is there in the next run, and the state file is private", async () => {
  const { mkdtempSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const stateFile = join(mkdtempSync(join(tmpdir(), "remuse-state-")), "state.json");
  const keeping = pool({ stateFile });
  const first = await keeping.open("r1", url);
  await first.context().addCookies([{ name: "session", value: "abc", url }]);
  await keeping.close("r1");
  assert.equal((statSync(stateFile).mode & 0o777).toString(8), "600");
  const second = await keeping.open("r2", url);
  assert.deepEqual((await second.context().cookies()).map((c) => [c.name, c.value]), [["session", "abc"]]);
  await keeping.shutdown();
});

test("saves merge: two runs that log in to different sites both stay logged in", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const stateFile = join(mkdtempSync(join(tmpdir(), "remuse-state-")), "state.json");
  const keeping = pool({ stateFile });
  const [a, b] = await Promise.all([keeping.open("a", url), keeping.open("b", url)]);
  await a.context().addCookies([{ name: "site-a", value: "1", url }]);
  await b.context().addCookies([{ name: "site-b", value: "2", url }]);
  await Promise.all([keeping.save("a"), keeping.save("b")]);
  const c = await keeping.open("c", url);
  assert.deepEqual((await c.context().cookies()).map((x) => x.name).sort(), ["site-a", "site-b"]);
  await keeping.shutdown();
});

test("a page that fails to open leaves no context; concurrent opens share one", async () => {
  const p = pool();
  await assert.rejects(p.open("bad", "http://127.0.0.1:1/"));
  assert.equal(p.page("bad"), undefined);
  const [x, y] = await Promise.all([p.open("same", url), p.open("same", url)]);
  assert.equal(x, y);
  await p.shutdown();
});
