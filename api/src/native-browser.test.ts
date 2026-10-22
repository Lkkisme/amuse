import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createHost, memoryChats, memoryRules, noKeys, noWorkspace, noLogins, noSandbox, type Ports } from "@amuse/core";
import { WebSocket, WebSocketServer } from "ws";
import { NativeBrowserManager } from "./native-browser.ts";

const edge = process.env["AMUSE_TEST_EDGE"] ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const execute = promisify(execFile);

function ports(): Ports {
  return {
    prompt: () => { throw new Error("The browser integration test must never invoke a model."); },
    interrupt: () => {}, title: async () => "unused", browse: () => {}, job: () => {}, task: () => {}, schedule: () => {},
    browser: () => {}, approval: () => {}, stopTask: () => {}, fit: () => {}, connect: async () => "https://example.invalid/",
    apps: { search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "https://example.invalid/", disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
    rules: memoryRules(), keys: noKeys, files: noWorkspace, logins: noLogins, sandbox: noSandbox,
  };
}

async function until<T>(read: () => T | undefined | Promise<T | undefined>, description: string, timeout = 8000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function jpegSize(bytes: Buffer): { width: number; height: number } {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "live image has a JPEG SOI marker");
  for (let offset = 2; offset + 8 < bytes.length;) {
    assert.equal(bytes[offset], 0xff);
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    assert.ok(length >= 2);
    offset += length;
  }
  throw new Error("No JPEG image dimensions found.");
}

/** Only discover processes whose command line names this test's unique profile. */
async function ownedEdgeProcesses(directory: string): Promise<number[]> {
  if (process.platform !== "win32") return [];
  const literal = directory.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$all = @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\")",
    `$owned = @($all | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf('${literal}', [StringComparison]::OrdinalIgnoreCase) -ge 0 })`,
    "$ids = @($owned | ForEach-Object { [int]$_.ProcessId })",
    "do { $more = @($all | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId }); $ids += $more } while ($more.Count -gt 0)",
    "ConvertTo-Json -Compress -InputObject @($ids | Select-Object -Unique)",
  ].join("\n");
  const result = await execute(join(process.env["SystemRoot"] ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 });
  return JSON.parse(result.stdout.trim()) as number[];
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

test("real isolated Edge shares agent/viewer state, enforces takeover and releases its processes", { skip: !existsSync(edge), timeout: 60_000 }, async (t) => {
  // One browser context for the entire test. Never use an installed user profile.
  const directory = mkdtempSync(join(tmpdir(), "amuse-native-edge-test-"));
  const verifiedDirectory = realpathSync(directory);
  const verifiedParent = realpathSync(tmpdir());
  assert.equal(dirname(verifiedDirectory).toLowerCase(), verifiedParent.toLowerCase());
  assert.ok(basename(verifiedDirectory).startsWith("amuse-native-edge-test-"));
  const rules = memoryRules();
  await rules.setBrowser("visit", "allow");
  await rules.setBrowser("submit", "allow");
  const manager = new NativeBrowserManager({ executablePath: edge, directory, maxBrowsers: 1, rules });
  const host = createHost({ ...ports(), ...manager.ports() }, { store: memoryChats() });
  manager.bind(host);
  let fixtureState = { seq: 0, value: "", count: 0, submitted: "", sawDrag: false, shiftDown: false, shiftUps: 0, mouseDowns: 0, mouseUps: 0 };
  const http = createServer((req, res) => {
    if (req.url === "/event" && req.method === "POST") {
      let body = "";
      req.on("data", (part) => { body += part.toString(); });
      req.on("end", () => { const incoming = JSON.parse(body) as typeof fixtureState; if (incoming.seq > fixtureState.seq) fixtureState = incoming; res.writeHead(204); res.end(); });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><html><head><title>Amuse isolated browser fixture</title><style>
      body{margin:0;background:#fcfcfc;color:#111112;font:20px sans-serif}h1{margin:24px 32px}
      #message{position:absolute;left:32px;top:92px;width:400px;height:44px;font:20px sans-serif}
      #apply{position:absolute;left:32px;top:160px;width:180px;height:48px;font:20px sans-serif;background:#0064d4;color:white}
      #status{position:absolute;left:32px;top:230px}#value{position:absolute;left:32px;top:280px}
    </style></head><body><h1>Shared browser fixture</h1><input id="message" aria-label="Message" autocomplete="off">
    <button id="apply" aria-label="Apply">Apply</button><div id="status">Count: 0; submitted: </div><div id="value">Value: </div>
    <script>let count=0,submitted='',seq=0,sawDrag=false,shiftDown=false,shiftUps=0,mouseDowns=0,mouseUps=0;const field=document.querySelector('#message');
      function report(){document.querySelector('#status').textContent='Count: '+count+'; submitted: '+submitted;document.querySelector('#value').textContent='Value: '+field.value;fetch('/event',{method:'POST',body:JSON.stringify({seq:++seq,value:field.value,count,submitted,sawDrag,shiftDown,shiftUps,mouseDowns,mouseUps})});}
      field.addEventListener('input',report);document.querySelector('#apply').onclick=()=>{count++;submitted=field.value;report();};
      document.addEventListener('mousemove',e=>{if(e.buttons===1)sawDrag=true;report();});
      document.addEventListener('mousedown',()=>{mouseDowns++;report();});document.addEventListener('mouseup',()=>{mouseUps++;report();});
      document.addEventListener('keydown',e=>{if(e.key==='Shift'){shiftDown=true;report();}});document.addEventListener('keyup',e=>{if(e.key==='Shift'){shiftDown=false;shiftUps++;report();}});
    </script></body></html>`);
  });
  const viewers = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let socket: WebSocket | undefined;
  let processes: number[] = [];
  t.after(async () => {
    socket?.terminate();
    for (const client of viewers.clients) client.terminate();
    await manager.shutdown();
    if (process.platform === "win32") await until(() => processes.every((pid) => !alive(pid)) ? true : undefined, "cleanup of the fixture's owned Edge process tree");
    await new Promise<void>((resolve) => viewers.close(() => resolve()));
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    // Delete only the mkdtemp target whose real absolute parent/name were checked.
    assert.equal(realpathSync(directory), verifiedDirectory);
    rmSync(verifiedDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const { id } = await manager.openForAgent("main", url);
  processes = await ownedEdgeProcesses(directory);
  if (process.platform === "win32") assert.ok(processes.length > 0, "the new Edge process tree is tied to this fixture profile");
  let view = await manager.observeForChat("main", id);
  assert.equal(view.url, url);
  assert.equal(view.title, "Amuse isolated browser fixture");
  const ref = (label: string) => { const element = view.elements.find((item) => item.label === label); assert.ok(element, `visible ${label} element`); return element.ref; };
  const before = Buffer.from(await manager.screenshotForChat("main", id));
  assert.deepEqual([...before.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual({ width: before.readUInt32BE(16), height: before.readUInt32BE(20) }, { width: 1024, height: 768 });
  view = await manager.actForChat("main", id, { kind: "type", ref: ref("Message"), text: "agent text" });
  view = await manager.actForChat("main", id, { kind: "click", ref: ref("Apply") });
  assert.match(view.text, /Count: 1; submitted: agent text/);
  await until(() => fixtureState.count === 1 ? true : undefined, "the agent's DOM update reaching the fixture");
  const after = Buffer.from(await manager.screenshotForChat("main", id));
  assert.notEqual(createHash("sha256").update(before).digest("hex"), createHash("sha256").update(after).digest("hex"), "the rendered image changes with actual page input");
  await assert.rejects(manager.observeForChat("other-chat", id), /另一个会话/);

  type Ready = { type: "ready"; transport: "native"; width: number; height: number; generation: number; url: string };
  const messages: (Ready | { type: "error"; message: string })[] = [];
  const frames: Buffer[] = [];
  viewers.on("connection", (viewer) => manager.attach(viewer, id, () => host.external.state("main").entities.some((entity) => entity.kind === "browser" && entity.id === id && entity.status === "paused" && entity.live)));
  await new Promise<void>((resolve) => { if (viewers.address()) resolve(); else viewers.once("listening", resolve); });
  const wsAddress = viewers.address(); assert.ok(wsAddress && typeof wsAddress !== "string");
  socket = new WebSocket(`ws://127.0.0.1:${wsAddress.port}`);
  socket.on("message", (data, binary) => {
    const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (binary) frames.push(bytes); else messages.push(JSON.parse(bytes.toString()) as (typeof messages)[number]);
  });
  await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
  const ready = await until(() => messages.find((message): message is Ready => message.type === "ready"), "native viewer ready metadata");
  assert.equal(ready.transport, "native"); assert.equal(ready.url, url);
  const frame = await until(() => frames[0], "a real JPEG live frame");
  assert.deepEqual(jpegSize(frame), { width: ready.width, height: ready.height });
  t.diagnostic(`Real Edge produced PNG ${before.readUInt32BE(16)}x${before.readUInt32BE(20)} (${before.length} bytes) and JPEG ${ready.width}x${ready.height} (${frame.length} bytes).`);
  const send = (value: unknown) => socket!.send(JSON.stringify(value));
  const pointer = (x: number, y: number, generation = ready.generation) => {
    send({ type: "pointer", action: "down", x: x / ready.width, y: y / ready.height, generation, button: 0 });
    send({ type: "pointer", action: "up", x: x / ready.width, y: y / ready.height, generation, button: 0 });
  };
  pointer(90, 180);
  await until(() => messages.find((message) => message.type === "error" && /接管/.test(message.message)), "unheld viewer input refusal");
  view = await manager.observeForChat("main", id);
  assert.match(view.text, /Count: 1;/);

  await host.call("browser.control", { id, action: "take" });
  await assert.rejects(manager.observeForChat("main", id), /接管/);
  await assert.rejects(manager.actForChat("main", id, { kind: "press", key: "Enter" }), /接管/);
  await assert.rejects(manager.finishForChat("main", id, "Should refuse"), /接管/);
  await assert.rejects(manager.screenshotForChat("main", id), /接管/);
  pointer(90, 110);
  send({ type: "key", action: "down", key: "a", code: "KeyA", modifiers: 2 });
  send({ type: "key", action: "up", key: "a", code: "KeyA", modifiers: 2 });
  send({ type: "text", text: "phone text" });
  await until(() => fixtureState.value === "phone text" ? true : undefined, "normalized viewer pointer and text reaching the same input");
  pointer(90, 180, ready.generation - 1); // Stale layout coordinates must be ignored.
  pointer(90, 180);
  await until(() => fixtureState.count === 2 && fixtureState.submitted === "phone text" ? true : undefined, "the held viewer clicking the same page button");
  assert.equal(fixtureState.count, 2);
  send({ type: "pointer", action: "down", x: 500 / ready.width, y: 350 / ready.height, generation: ready.generation, button: 0 });
  send({ type: "pointer", action: "move", x: 550 / ready.width, y: 350 / ready.height, generation: ready.generation, button: 0 });
  await until(() => fixtureState.sawDrag ? true : undefined, "a real DOM mousemove with buttons=1 during viewer drag");
  send({ type: "pointer", action: "up", x: 550 / ready.width, y: 350 / ready.height, generation: ready.generation, button: 0 });
  const shiftsBefore = fixtureState.shiftUps;
  const downsBefore = fixtureState.mouseDowns;
  send({ type: "key", action: "down", key: "Shift", code: "ShiftLeft", modifiers: 8 });
  send({ type: "pointer", action: "down", x: 550 / ready.width, y: 350 / ready.height, generation: ready.generation, button: 0 });
  await until(() => fixtureState.shiftDown && fixtureState.mouseDowns > downsBefore ? true : undefined, "the viewer leaving Shift and the mouse pressed");
  const upsBefore = fixtureState.mouseUps;
  await host.call("browser.control", { id, action: "handBack" });
  await until(() => !fixtureState.shiftDown && fixtureState.shiftUps > shiftsBefore && fixtureState.mouseUps > upsBefore ? true : undefined, "hand-back delivering real keyup and mouseup events");
  view = await manager.observeForChat("main", id);
  assert.match(view.text, /Count: 2; submitted: phone text/);
  assert.match(view.text, /Value: phone text/);
  view = await manager.actForChat("main", id, { kind: "click", ref: ref("Apply") });
  assert.match(view.text, /Count: 3; submitted: phone text/);

  // Multiple viewers share one CDP screencast, while every new viewer also gets
  // its own ready metadata and initial screenshot of this exact page.
  const connectViewer = async () => {
    const peer = new WebSocket(`ws://127.0.0.1:${wsAddress.port}`);
    const peerMessages: (typeof messages)[number][] = [];
    const peerFrames: Buffer[] = [];
    peer.on("message", (data, binary) => {
      const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      if (binary) peerFrames.push(bytes); else peerMessages.push(JSON.parse(bytes.toString()) as (typeof messages)[number]);
    });
    await new Promise<void>((resolve, reject) => { peer.once("open", resolve); peer.once("error", reject); });
    const peerReady = await until(() => peerMessages.find((message): message is Ready => message.type === "ready"), "another viewer's ready metadata");
    const peerFrame = await until(() => peerFrames[0], "another viewer's real JPEG frame");
    assert.equal(peerReady.url, url);
    assert.deepEqual(jpegSize(peerFrame), { width: peerReady.width, height: peerReady.height });
    assert.equal(peerMessages.some((message) => message.type === "error"), false, "another viewer must not restart an already active screencast");
    return { peer, frames: peerFrames, messages: peerMessages };
  };
  const firstErrors = messages.filter((message) => message.type === "error").length;
  const second = await connectViewer();
  assert.equal(messages.filter((message) => message.type === "error").length, firstErrors, "attaching the second viewer preserves the first stream");
  const first = socket;
  await new Promise<void>((resolve) => { first.once("close", resolve); first.close(); });
  socket = second.peer;
  const secondBefore = second.frames.length;
  view = await manager.actForChat("main", id, { kind: "click", ref: ref("Apply") });
  assert.match(view.text, /Count: 4; submitted: phone text/);
  await until(() => second.frames.length > secondBefore ? true : undefined, "the second viewer receiving a changed page after the first closes");
  assert.equal(second.messages.some((message) => message.type === "error"), false);
  await new Promise<void>((resolve) => { second.peer.once("close", resolve); second.peer.close(); });
  const third = await connectViewer();
  socket = third.peer;
  const thirdBefore = third.frames.length;
  view = await manager.actForChat("main", id, { kind: "click", ref: ref("Apply") });
  assert.match(view.text, /Count: 5; submitted: phone text/);
  await until(() => third.frames.length > thirdBefore ? true : undefined, "a reconnected viewer receiving changed-page frames after the last viewer disconnected");
  assert.equal(third.messages.some((message) => message.type === "error"), false);
  t.diagnostic(`Two simultaneous viewers received ready+JPEG without new errors; second viewer kept ${second.frames.length} frames after first closed; third viewer restored ${third.frames.length} frames after last disconnect.`);

  await manager.finishForChat("main", id, "Shared page fixture completed");
  const entity = host.external.state("main").entities.find((item) => item.id === id);
  assert.ok(entity?.kind === "browser"); assert.equal(entity.outcome, "completed");
  const frameCount = frames.length;
  await manager.close(id);
  assert.equal(await manager.stillOpen(id), false);
  assert.equal(manager.owns(id), false);
  if (process.platform === "win32") await until(() => processes.every((pid) => !alive(pid)) ? true : undefined, "the fixture's owned Edge process tree exiting");
  t.diagnostic(`Verified PNG ${before.readUInt32BE(16)}x${before.readUInt32BE(20)} (${before.length} bytes), JPEG ${ready.width}x${ready.height} (${frame.length} bytes), ${frameCount} live frames, agent→phone→agent DOM state, drag buttons=1, hand-back Shift keyup/mouseup, and ${processes.length} owned Edge processes exited.`);
});
