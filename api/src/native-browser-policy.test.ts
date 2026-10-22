import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { existsSync, mkdtempSync, realpathSync, rmSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { createHost, memoryChats, memoryRules, noKeys, noLogins, noSandbox, noWorkspace, type Host, type Ports, type Rules } from "@amuse/core";
import { WebSocketServer } from "ws";
import { NativeBrowserManager } from "./native-browser.ts";
import { fileChats } from "./journal.ts";
import { snapshotBrowsers } from "./browser-checkpoint.ts";

const edge = process.env["AMUSE_TEST_EDGE"] ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const nodeModel = () => { throw new Error("Native browser policy tests must never call a model."); };
function ports(rules: Rules): Ports {
  return {
    prompt: nodeModel, interrupt: () => {}, title: async () => "unused", browse: () => {}, job: () => {}, task: nodeModel, schedule: nodeModel,
    browser: () => {}, approval: () => {}, stopTask: () => {}, fit: () => {}, connect: async () => "https://example.invalid/",
    apps: { search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "https://example.invalid/", disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
    rules, keys: noKeys, files: noWorkspace, logins: noLogins, sandbox: noSandbox,
  };
}
async function until<T>(read: () => T | undefined | Promise<T | undefined>, label: string, timeout = 10000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value !== undefined) return value; await new Promise<void>((resolve) => setTimeout(resolve, 20)); }
  throw new Error(`Timed out waiting for ${label}.`);
}
const pending = (host: Host, action: RegExp) => host.external.state("main").entities.find((entity) => entity.kind === "approval" && entity.status === "pending" && action.test(entity.action));
const refused = (host: Host, detail: RegExp) => host.external.state("main").entities.find((entity) => entity.kind === "approval" && entity.byRule && detail.test(entity.detail));

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "amuse-native-policy-"));
  const verified = realpathSync(directory);
  assert.equal(dirname(verified).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(basename(verified).startsWith("amuse-native-policy-"));
  const managers: NativeBrowserManager[] = [];
  const hits = { page: 0, target: 0, posts: 0, downloads: 0 };
  const previewRequests: { url: string; cookie: string; origin: string }[] = [];
  const hmrRequests: string[] = [];
  const requestPaths: string[] = [];
  const hmr = new WebSocketServer({ noServer: true });
  let port = 0;
  const html = (message: string) => `<!doctype html><html><head><title>Native policy fixture</title></head><body>
    <div id="message">${message}</div>
    <form method="POST" action="/save"><button aria-label="Save form">Save form</button></form>
    <a href="http://localhost:${port}/target" aria-label="Other site">Other site</a>
    <button aria-label="Dynamic navigation" onclick="location.href='http://localhost:${port}/target'">Dynamic navigation</button>
    <button aria-label="Dynamic POST" onclick="fetch('/save',{method:'POST',body:'script-change'})">Dynamic POST</button>
    <a href="/download" aria-label="Download fixture">Download fixture</a>
    <input type="file" aria-label="Upload fixture" onchange="document.querySelector('#file').textContent=this.files[0]?.name||'none'"><div id="file">none</div>
    <button aria-label="Restore stale login" onclick="document.cookie='stale=old;path=/';localStorage.setItem('session','stale');">Restore stale login</button>
    <script>document.querySelector('#message').textContent+='; local='+(localStorage.getItem('session')||'none')</script>
    </body></html>`;
  const server = createServer((req, res) => {
    requestPaths.push(req.url ?? "");
    if (req.url?.startsWith("/preview/")) {
      previewRequests.push({ url: req.url, cookie: req.headers.cookie ?? "", origin: req.headers.origin ?? "" });
      if (req.url.startsWith("/preview/3000/asset")) { res.setHeader("content-type", "text/plain"); res.end("sandbox asset loaded"); return; }
      if (req.url.startsWith("/preview/3000/go")) { res.writeHead(302, { location: "http://127.0.0.1:3000/hello?mode=redirected" }); res.end(); return; }
      if (req.url.startsWith("/preview/3000/leave")) { res.writeHead(302, { location: `http://localhost:${port}/target` }); res.end(); return; }
      res.setHeader("content-type", "text/html");
      res.setHeader("set-cookie", "preview=logical-only; Path=/; SameSite=Lax");
      res.end(`<!doctype html><html><head><title>Sandbox preview fixture</title></head><body>
        <p id="asset">loading asset</p><p id="hmr">loading socket</p><p>source=${req.headers.cookie ?? "none"}</p>
        <script>fetch('/asset?cache=off').then(r=>r.text()).then(t=>document.querySelector('#asset').textContent=t);
        const socket=new WebSocket('ws://sandbox:3000/hmr?token=fixture','vite-hmr');
        socket.onopen=()=>socket.send('fixture ping');socket.onmessage=e=>document.querySelector('#hmr').textContent=e.data;</script>
        </body></html>`);
      return;
    }
    if (req.url === "/save" && req.method === "POST") { hits.posts++; res.setHeader("content-type", "text/html"); res.end(html("Saved")); return; }
    if (req.url === "/redirect") { res.writeHead(302, { location: `http://localhost:${port}/target` }); res.end(); return; }
    if (req.url === "/target") hits.target++;
    if (req.url === "/download") { hits.downloads++; res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="fixture.txt"' }); res.end("downloaded fixture bytes"); return; }
    hits.page++;
    res.setHeader("content-type", "text/html");
    if (req.url === "/login") {
      res.setHeader("set-cookie", "session=owner-secret; Path=/; HttpOnly; SameSite=Lax");
      res.end(html("Login page").replace("<script>", "<script>localStorage.setItem('session','owner-local-secret');"));
      return;
    }
    res.end(html(`cookie=${req.headers.cookie?.includes("session=owner-secret") ? "signed-in" : "none"}`));
  });
  server.on("upgrade", (req, socket, head) => {
    hmrRequests.push(req.url ?? "");
    if (!req.url?.startsWith("/preview/3000/hmr?")) { socket.destroy(); return; }
    hmr.handleUpgrade(req, socket, head, (connection) => {
      connection.on("message", (message) => connection.send(`HMR echo: ${message.toString()}`));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string"); port = address.port;
  const url = `http://127.0.0.1:${port}`;
  const create = (rules: Rules, maxBrowsers = 2, sandboxUrl?: string, store = memoryChats()) => {
    const manager = new NativeBrowserManager({ executablePath: edge, directory, maxBrowsers, rules, ...(sandboxUrl ? { sandboxUrl } : {}) });
    const host = createHost({ ...ports(rules), ...manager.ports() }, { store, timers: { set: (ms, fn) => setTimeout(fn, ms).unref(), clear: clearTimeout } });
    manager.bind(host); managers.push(manager); return { manager, host };
  };
  t.after(async () => {
    await Promise.allSettled(managers.map((manager) => manager.shutdown()));
    for (const connection of hmr.clients) connection.terminate();
    await new Promise<void>((resolve) => hmr.close(() => resolve()));
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(realpathSync(directory), verified);
    rmSync(verified, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });
  return { create, hits, url, directory, previewRequests, hmrRequests, requestPaths };
}

// These are complete real browser operations against an isolated local HTTP
// fixture. No public sites, installed browser profile, live Amuse or Qwen model.
test("native Edge applies unified visit/submit/download/upload policy, approvals and takeover cancellation", { skip: !existsSync(edge), timeout: 90000 }, async (t) => {
  const { create, hits, url } = await fixture(t);
  const rules = memoryRules();
  await rules.setBrowser("visit", "deny");
  const { manager, host } = create(rules, 1);
  await assert.rejects(manager.openForAgent("main", `${url}/`), /Refused by/);
  assert.equal(hits.page, 0, "a denied initial address never reaches the HTTP server");
  assert.ok(refused(host, /Deny/));
  assert.equal(host.external.state("main").entities.some((entity) => entity.kind === "approval" && entity.status === "pending"), false, "hard deny does not ask");

  await rules.setBrowser("visit", "ask");
  const opening = manager.openForAgent("main", `${url}/`);
  const first = await until(() => pending(host, /Visit/), "visit approval");
  assert.equal(hits.page, 0, "the HTTP request remains blocked while waiting for approval");
  await host.call("approval.resolve", { id: first.id, resolution: "allow_always" });
  const { id } = await opening;
  assert.equal((await rules.sites())["127.0.0.1"]?.actions.visit, "allow", "an always answer uses the normal site policy store");

  const ref = async (label: string) => { const view = await manager.observeForChat("main", id); const element = view.elements.find((item) => item.label === label); assert.ok(element); return element.ref; };
  await rules.setBrowser("submit", "deny");
  await assert.rejects(manager.actForChat("main", id, { kind: "click", ref: await ref("Save form") }), /Refused by/);
  assert.equal(hits.posts, 0, "a form POST cannot bypass submit Deny by omitting consequential");
  await assert.rejects(manager.actForChat("main", id, { kind: "click", ref: await ref("Save form"), consequential: true, what: "Save form", why: "policy fixture" }), /Refused by/);
  assert.equal(hits.posts, 0);
  await assert.rejects(manager.actForChat("main", id, { kind: "click", ref: await ref("Dynamic POST") }), /Refused by/);
  assert.equal(hits.posts, 0, "a script's fetch POST cannot bypass the submit rule either");

  await rules.setSite("localhost", { never: true, actions: {} });
  await assert.rejects(manager.actForChat("main", id, { kind: "click", ref: await ref("Other site") }), /Refused by/);
  assert.equal(hits.target, 0, "a link's script/document navigation is checked before the destination receives it");
  assert.ok(refused(host, /localhost/));
  await assert.rejects(manager.actForChat("main", id, { kind: "click", ref: await ref("Dynamic navigation") }), /Refused by/);
  assert.equal(hits.target, 0, "a script's navigation without an anchor is blocked too");
  await assert.rejects(manager.actForChat("main", id, { kind: "navigate", url: `${url}/redirect` }), /Refused by/);
  assert.equal(hits.target, 0, "an allowed origin's HTTP redirect cannot reach a denied origin");

  await rules.setBrowser("download", "deny");
  await manager.actForChat("main", id, { kind: "click", ref: await ref("Download fixture") }).catch((error: unknown) => assert.match(String(error), /Refused by/));
  await until(() => refused(host, /downloading/), "download denial");
  assert.deepEqual(await manager.downloads(id), [], "refused downloads are not exposed as kept files");
  await rules.setBrowser("download", "ask");
  const download = manager.actForChat("main", id, { kind: "click", ref: await ref("Download fixture") });
  const downloadAsk = await until(() => pending(host, /Download fixture.txt/), "download approval");
  await host.call("approval.resolve", { id: downloadAsk.id, resolution: "allow_once" });
  await download;
  const files = await until(async () => { const got = await manager.downloads(id); return got.length ? got : undefined; }, "approved download bytes");
  assert.equal(files[0]!.name, "fixture.txt"); assert.equal(Buffer.from(files[0]!.data).toString(), "downloaded fixture bytes");

  await rules.setBrowser("upload", "allow"); // upstream intentionally settles upload Allow to Ask
  const uploading = manager.upload(id, await ref("Upload fixture"), { name: "owner-file.txt", data: new TextEncoder().encode("owned fixture") });
  const uploadAsk = await until(() => pending(host, /Upload owner-file.txt/), "upload approval even with Allow configured");
  await host.call("approval.resolve", { id: uploadAsk.id, resolution: "allow_once" });
  await uploading;
  assert.match((await manager.observeForChat("main", id)).text, /owner-file.txt/);

  await rules.setBrowser("submit", "ask");
  const action = manager.actForChat("main", id, { kind: "click", ref: await ref("Save form"), consequential: true, what: "Save approved form", why: "test pause before submission" });
  await until(() => pending(host, /Save approved form/), "consequential submission approval");
  await host.call("browser.control", { id, action: "take" });
  await assert.rejects(action, /stopped|接管/);
  assert.equal(hits.posts, 0, "taking control cancels the pending agent action before any submit");
  await assert.rejects(manager.observeForChat("main", id), /接管/);
  t.diagnostic("Real Edge blocked initial Deny, unmarked POST, cross-site navigation and refused download; normal approval cards allowed visit/download/upload, and takeover cancelled a pending consequential step.");
});

test("native Edge keeps shared cookies/localStorage across new runs and restarts, forgets only the requested site everywhere", { skip: !existsSync(edge), timeout: 90000 }, async (t) => {
  const { create, url, directory } = await fixture(t);
  const rules = memoryRules(); await rules.setBrowser("visit", "allow"); await rules.setBrowser("submit", "allow");
  const first = create(rules);
  const one = await first.manager.openForChat("main", `${url}/login`);
  await first.manager.remember(one.id);
  assert.deepEqual(await first.manager.logins(), [{ site: "127.0.0.1", cookies: 1 }]);
  const rendered = JSON.stringify(await first.manager.logins());
  assert.doesNotMatch(rendered, /owner-secret|owner-local-secret/, "login metadata contains no credentials");
  await first.manager.close(one.id);
  assert.deepEqual(readdirSync(join(directory, "profiles")), [], "closed native profile directories do not retain old cookies");

  const next = create(rules);
  const two = await next.manager.openForAgent("main", `${url}/whoami`);
  assert.match((await next.manager.observeForChat("main", two.id)).text, /cookie=signed-in; local=owner-local-secret/, "another manager/run restores cookie and origin storage from the owner-only saved state");
  const otherUrl = url.replace("127.0.0.1", "localhost");
  const other = await next.manager.openForAgent("main", `${otherUrl}/login`);
  await next.manager.remember(other.id);
  assert.deepEqual(await next.manager.logins(), [{ site: "127.0.0.1", cookies: 1 }, { site: "localhost", cookies: 1 }]);

  await next.manager.forgetLogin("127.0.0.1");
  assert.deepEqual(await next.manager.logins(), [{ site: "localhost", cookies: 1 }], "forgetting one site preserves another site's login");
  let page = await next.manager.actForChat("main", two.id, { kind: "navigate", url: `${url}/whoami` });
  assert.match(page.text, /cookie=none; local=none/, "forget clears the matching cookies and local storage from an already open context");
  const stale = page.elements.find((item) => item.label === "Restore stale login"); assert.ok(stale);
  await next.manager.actForChat("main", two.id, { kind: "click", ref: stale.ref });
  await next.manager.remember(two.id);
  assert.deepEqual(await next.manager.logins(), [{ site: "localhost", cookies: 1 }], "an old page cannot re-save a forgotten site's cookies");
  page = await next.manager.actForChat("main", other.id, { kind: "navigate", url: `${otherUrl}/whoami` });
  assert.match(page.text, /cookie=signed-in; local=owner-local-secret/, "the unrelated live context remains signed in");
  await next.manager.close(two.id); await next.manager.close(other.id);
  const restarted = create(rules);
  const restored = await restarted.manager.openForAgent("main", `${url}/whoami`);
  assert.match((await restarted.manager.observeForChat("main", restored.id)).text, /cookie=none; local=none/);
  assert.deepEqual(await restarted.manager.logins(), [{ site: "localhost", cookies: 1 }]);
  t.diagnostic("Saved HttpOnly cookies plus origin localStorage survived a new manager/run; forget removed 127.0.0.1 from persistent and live state, preserved localhost, and stale pages could not restore the forgotten login.");
});


test("native Edge previews sandbox ports through the daemon with logical URLs, isolated cookies, HMR and redirect policy", { skip: !existsSync(edge), timeout: 90000 }, async (t) => {
  const { create, url, hits, previewRequests, hmrRequests } = await fixture(t);
  const rules = memoryRules(); await rules.setBrowser("visit", "allow"); await rules.setBrowser("submit", "allow");
  await rules.setSite("localhost", { never: true, actions: {} });
  const { manager } = create(rules, 1, url);
  const seed = await manager.openForChat("main", `${url}/login`);
  await manager.remember(seed.id); await manager.close(seed.id);
  const { id } = await manager.openForAgent("main", "http://sandbox:3000/hello?mode=initial");
  const view = await until(async () => {
    const view = await manager.observeForChat("main", id);
    return /sandbox asset loaded/.test(view.text) && /HMR echo: fixture ping/.test(view.text) ? view : undefined;
  }, "proxied relative asset and websocket HMR frame");
  assert.equal(view.url, "http://sandbox:3000/hello?mode=initial", "the phone and agent retain the logical sandbox source");
  assert.equal(view.title, "Sandbox preview fixture");
  assert.ok(previewRequests.some((request) => request.url === "/preview/3000/hello?mode=initial"));
  assert.ok(previewRequests.some((request) => request.url === "/preview/3000/asset?cache=off"));
  assert.ok(hmrRequests.includes("/preview/3000/hmr?token=fixture"));
  assert.equal(previewRequests.every((request) => request.origin === ""), true, "only the trusted Node bridge contacts the daemon");
  assert.equal(previewRequests.some((request) => request.cookie.includes("owner-secret")), false, "the loopback daemon never receives the owner's unrelated browser cookies");
  assert.ok(previewRequests.some((request) => request.cookie.includes("preview=logical-only")), "the preview's logical source cookie is retained");
  const redirected = await manager.actForChat("main", id, { kind: "navigate", url: "http://sandbox:3000/go" });
  assert.equal(redirected.url, "http://sandbox:3000/hello?mode=redirected", "a dev server's loopback redirect stays on the logical sandbox source");
  await assert.rejects(manager.actForChat("main", id, { kind: "navigate", url: "http://sandbox:3000/leave" }), /Refused by/);
  assert.equal(hits.target, 0, "a preview's external redirect still passes the network-before-policy gate");
  const before = previewRequests.length;
  const refused = await manager.actForChat("main", id, { kind: "navigate", url: "http://sandbox:7070/run" });
  assert.match(refused.text, /control port cannot be opened/);
  assert.equal(previewRequests.length, before, "the control port is rejected before making any daemon request");
  t.diagnostic("Real Edge kept http://sandbox:3000 logical source, proxied relative assets and HMR over /preview/3000, isolated owner cookies, blocked 7070, and refused a denied external redirect before HTTP delivery.");
});


const oldBrowser = (id: string, url: string, status: "paused" | "idle" | "working" = "paused") => ({ kind: "browser" as const, id, at: "2026-10-21T12:00:00.000Z", title: "Saved browser", url, status, instructions: status === "working" ? "Old task must not be replayed." : "", result: null, outcome: null, step: null, live: true, files: [] });

test("owner stop checkpoint survives real Edge termination and core recovery, then cannot revive a user-closed page", { skip: !existsSync(edge) || process.platform !== "win32", timeout: 90000 }, async (t) => {
  const { create, url, directory, requestPaths } = await fixture(t);
  const data = join(directory, "data"), journalPath = join(data, "events.jsonl");
  const store = () => fileChats(data, journalPath);
  const rules = memoryRules(); await rules.setBrowser("visit", "allow");
  const original = create(rules, 1, undefined, store());
  const { id } = await original.manager.openForChat("main", `${url}/held-owner-page`);
  original.host.external.ingest("main", [
    { kind: "upserted", entity: oldBrowser("user-stopped-after-checkpoint", `${url}/must-not-revive-stop`) },
    { kind: "upserted", entity: oldBrowser("new-job-after-checkpoint", `${url}/must-not-replay-job`) },
    { kind: "upserted", entity: oldBrowser("new-url-after-checkpoint", `${url}/old-url`) },
  ]);
  const checkpoint = snapshotBrowsers({ journalPath, directory, ownerPid: process.pid });
  assert.equal(checkpoint.browsers.length, 4);
  const saved = checkpoint.browsers.find((entry) => entry.browser.id === id)!.browser;
  assert.equal(saved.status, "paused"); assert.equal(saved.live, true);
  original.host.external.ingest("main", [
    { kind: "upserted", entity: { ...oldBrowser("user-stopped-after-checkpoint", `${url}/must-not-revive-stop`), status: "stopped", live: false } },
    { kind: "upserted", entity: oldBrowser("new-job-after-checkpoint", `${url}/must-not-replay-job`, "working") },
    { kind: "upserted", entity: { ...oldBrowser("new-url-after-checkpoint", `${url}/changed-url`), live: false } },
  ]);

  // Identify only the root Edge process whose command line contains this
  // freshly-created unique profile. No production or user browser is touched.
  const profile = join(directory, "profiles", createHash("sha256").update(id).digest("hex").slice(0, 24));
  assert.equal(dirname(dirname(profile)), directory);
  const literal = profile.replaceAll("'", "''");
  const powershell = join(process.env["SystemRoot"] ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const execute = promisify(execFile);
  const script = `$owned = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf('${literal}', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -notmatch '--type=' }); ConvertTo-Json -Compress -InputObject @($owned | ForEach-Object { [int]$_.ProcessId })`;
  const discovery = await execute(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10000 });
  const pids = JSON.parse(discovery.stdout.trim()) as number[];
  assert.equal(pids.length, 1, "exactly one owned Edge root is targeted");
  assert.ok(Number.isSafeInteger(pids[0]) && pids[0]! > 0);
  await execute(join(process.env["SystemRoot"] ?? "C:/Windows", "System32/taskkill.exe"), ["/PID", String(pids[0]), "/T", "/F"], { windowsHide: true, timeout: 15000 });
  await until(() => original.host.external.state("main").entities.find((entity) => entity.id === id && entity.kind === "browser" && !entity.live), "old page.close handler recording released after Edge death");
  await until(() => !existsSync(profile) ? true : undefined, "old owned browser profile cleanup");

  const restarted = create(rules, 1, undefined, store());
  const recovered = restarted.host.external.state("main").entities.find((entity) => entity.id === id);
  assert.ok(recovered?.kind === "browser"); assert.equal(recovered.live, false, "core recovery also clears live before native restoration");
  const restored = await restarted.manager.restoreExisting();
  assert.deepEqual(restored, { restored: 1, ended: 0, migratedProfiles: 0 });
  const page = restarted.host.external.state("main").entities.find((entity) => entity.id === id);
  assert.ok(page?.kind === "browser"); assert.equal(page.status, "paused"); assert.equal(page.live, true); assert.equal(page.url, saved.url);
  assert.equal(restarted.manager.list("main").find((browser) => browser.id === id)?.controlledBy, "user");
  assert.ok((await restarted.manager.screenshot(id)).length > 1000, "the original page has an actual restored viewer image");
  assert.equal(requestPaths.some((path) => /must-not-revive|must-not-replay|changed-url/.test(path)), false, "a user stop, changed job and new URL remain authoritative");
  assert.equal(readdirSync(directory).filter((name) => name.startsWith("resume.consumed.")).length, 1);
  assert.equal(existsSync(join(directory, "resume.json")), false);
  await restarted.host.call("browser.control", { id, action: "stop" });
  await until(() => !existsSync(profile) ? true : undefined, "user-close profile cleanup");
  const third = create(rules, 1, undefined, store());
  assert.deepEqual(await third.manager.restoreExisting(), { restored: 0, ended: 0, migratedProfiles: 0 });
  assert.equal(await third.manager.stillOpen(id), false, "a consumed checkpoint never revives a later user close");
  t.diagnostic("Killed only the temporary owned Edge tree; its actual close event cleared live, the one-use owner checkpoint restored the original paused viewer after journal/core recovery, and a later user stop stayed closed.");
});

test("native restart migrates legacy per-run login profiles and restores saved paused/idle pages without replaying work", { skip: !existsSync(edge), timeout: 120000 }, async (t) => {
  const { create, url, directory, requestPaths } = await fixture(t);
  const legacyId = "legacy-paused-browser";
  const profile = join(directory, "profiles", createHash("sha256").update(legacyId).digest("hex").slice(0, 24));
  const legacy = await chromium.launchPersistentContext(profile, { executablePath: edge, headless: true, serviceWorkers: "block" });
  try { const page = legacy.pages()[0] ?? await legacy.newPage(); await page.goto(`${url}/login`); await legacy.addCookies((await legacy.cookies()).map((cookie) => ({ ...cookie, expires: Math.floor(Date.now() / 1000) + 3600 }))); }
  finally { await legacy.close(); }
  assert.equal(existsSync(join(directory, "logins.json")), false, "this is an actual old profile, without the new owner login file");
  const before = requestPaths.length;
  const rules = memoryRules(); await rules.setBrowser("visit", "allow");
  const { manager, host } = create(rules, 2);
  host.external.ingest("main", [
    { kind: "upserted", entity: oldBrowser(legacyId, `${url}/whoami`) },
    { kind: "upserted", entity: oldBrowser("saved-idle-browser", `${url}/whoami`, "idle") },
    { kind: "upserted", entity: oldBrowser("old-working-browser", `${url}/must-not-replay`, "working") },
    { kind: "upserted", entity: oldBrowser("unconfigured-preview", "http://sandbox:3000/old") },
  ]);
  const result = await manager.restoreExisting();
  assert.deepEqual(result, { restored: 2, ended: 2, migratedProfiles: 1 });
  assert.equal(requestPaths.slice(before).filter((path) => path === "/whoami").length, 2);
  assert.equal(requestPaths.slice(before).some((path) => path === "/" || path === "/login" || path === "/must-not-replay"), false, "migration only reads blank intercepted origin documents; no old task or saved-site request is replayed");
  assert.deepEqual(await manager.logins(), [{ site: "127.0.0.1", cookies: 1 }]);
  assert.ok(existsSync(join(directory, "logins.json")));
  const state = host.external.state("main");
  assert.ok(state.entities.some((entity) => entity.kind === "browser" && entity.id === legacyId && entity.status === "paused" && entity.live));
  assert.ok(state.entities.some((entity) => entity.kind === "browser" && entity.id === "saved-idle-browser" && entity.status === "idle" && entity.live));
  assert.ok(state.entities.some((entity) => entity.kind === "browser" && entity.id === "old-working-browser" && !entity.live && entity.outcome === "failed"));
  assert.ok(state.entities.some((entity) => entity.kind === "browser" && entity.id === "unconfigured-preview" && !entity.live && /not configured/.test(entity.result ?? "")));
  assert.equal(manager.list("main").find((browser) => browser.id === legacyId)?.controlledBy, "user");
  await assert.rejects(manager.observeForChat("main", legacyId), /接管/);
  const restored = await manager.observeForChat("main", "saved-idle-browser");
  assert.match(restored.text, /cookie=signed-in; local=owner-local-secret/, "both HttpOnly cookies and localStorage survived the old profile migration");
  assert.deepEqual(await manager.restoreExisting(), result);
  assert.equal(requestPaths.slice(before).filter((path) => path === "/whoami").length, 2, "calling restore a second time never launches duplicate pages");

  await manager.forgetLogin("127.0.0.1");
  const saved = host.external.state("main").entities.filter((entity) => entity.kind === "browser" && entity.live);
  await manager.shutdown();
  assert.deepEqual(readdirSync(join(directory, "profiles")), []);
  const restarted = create(rules, 2);
  restarted.host.external.ingest("main", saved.map((entity) => ({ kind: "upserted", entity })));
  assert.deepEqual(await restarted.manager.restoreExisting(), { restored: 2, ended: 0, migratedProfiles: 0 });
  assert.deepEqual(await restarted.manager.logins(), []);
  assert.match((await restarted.manager.observeForChat("main", "saved-idle-browser")).text, /cookie=none; local=none/, "forgotten legacy logins do not return after another server restart");
  t.diagnostic("Migrated an actual old Edge profile without network reads; restored original browser IDs/statuses, preserved cookies/localStorage, refused stale work and missing preview service, and kept forget effective across a further restart.");
});

test("restoring an idle browser respects Deny and does not block server startup on an Ask card", { skip: !existsSync(edge), timeout: 90000 }, async (t) => {
  const { create, url, hits } = await fixture(t);
  const rules = memoryRules(); await rules.setBrowser("visit", "deny");
  const blocked = create(rules, 1);
  blocked.host.external.ingest("main", [{ kind: "upserted", entity: oldBrowser("denied-idle", `${url}/whoami`, "idle") }]);
  assert.deepEqual(await blocked.manager.restoreExisting(), { restored: 0, ended: 1, migratedProfiles: 0 });
  assert.equal(hits.page, 0);
  assert.ok(refused(blocked.host, /Deny/));

  await rules.setBrowser("visit", "ask");
  const waiting = create(rules, 1);
  waiting.host.external.ingest("main", [{ kind: "upserted", entity: oldBrowser("waiting-idle", `${url}/whoami`, "idle") }]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restored = await Promise.race([waiting.manager.restoreExisting(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Restore blocked startup while awaiting a user approval.")), 20000); })]).finally(() => clearTimeout(timer));
  assert.deepEqual(restored, { restored: 1, ended: 0, migratedProfiles: 0 });
  assert.equal(hits.page, 0, "the unapproved saved page has not received a request");
  const asked = await until(() => pending(waiting.host, /Visit/), "saved-page approval");
  assert.equal((await waiting.manager.info("waiting-idle")).transport, "native", "the blank live viewer is available while the normal approval card waits");
  await waiting.host.call("approval.resolve", { id: asked.id, resolution: "allow_once" });
  const ready = await until(() => waiting.manager.list("main").find((browser) => browser.id === "waiting-idle" && browser.url === `${url}/whoami`), "approved saved idle page loading");
  assert.ok(ready);
  assert.match((await waiting.manager.observeForChat("main", "waiting-idle")).text, /cookie=none/);
});

test("cancelling a native tool before approval prevents later writes without aborting the shared browser", { skip: !existsSync(edge), timeout: 90000 }, async (t) => {
  const { create, url, hits } = await fixture(t);
  const rules = memoryRules(); await rules.setBrowser("visit", "allow"); await rules.setBrowser("submit", "ask");
  const { manager, host } = create(rules, 2);
  const { id } = await manager.openForAgent("main", `${url}/`);
  const ref = async (label: string) => { const view = await manager.observeForChat("main", id); const found = view.elements.find((item) => item.label === label); assert.ok(found); return found.ref; };
  const stop = new AbortController();
  const action = manager.actForChat("main", id, { kind: "click", ref: await ref("Save form"), consequential: true, what: "Cancelled submit", why: "Verify the background task stop signal." }, stop.signal);
  const approval = await until(() => pending(host, /Cancelled submit/), "the cancelled operation's approval card");
  stop.abort();
  await assert.rejects(action, /cancelled|stopped/);
  await host.call("approval.resolve", { id: approval.id, resolution: "allow_once" });
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  assert.equal(hits.posts, 0, "allowing a stale card cannot restart a cancelled browser operation");
  assert.equal(await manager.stillOpen(id), true);
  assert.match((await manager.observeForChat("main", id)).text, /Save form/, "the same browser remains usable by another operation");
  await assert.rejects(manager.observeForChat("main", id, stop.signal), /cancelled/);
  await assert.rejects(manager.screenshotForChat("main", id, stop.signal), /cancelled/);
  await assert.rejects(manager.finishForChat("main", id, "must not finish", stop.signal), /cancelled/);

  const uploadStop = new AbortController();
  const upload = manager.upload(id, await ref("Upload fixture"), { name: "cancelled-file.txt", data: new TextEncoder().encode("must not upload") }, uploadStop.signal);
  const uploadApproval = await until(() => pending(host, /Upload cancelled-file.txt/), "upload approval");
  uploadStop.abort(); await assert.rejects(upload, /cancelled|stopped/);
  await host.call("approval.resolve", { id: uploadApproval.id, resolution: "allow_once" });
  assert.doesNotMatch((await manager.observeForChat("main", id)).text, /cancelled-file.txt/);

  await rules.setBrowser("visit", "ask");
  const pages = hits.page;
  const openStop = new AbortController();
  const opening = manager.openForAgent("main", `${url}/must-not-open`, openStop.signal);
  const openApproval = await until(() => pending(host, /Visit/), "new browser's opening approval");
  openStop.abort(); await assert.rejects(opening, /cancelled|stopped/);
  await host.call("approval.resolve", { id: openApproval.id, resolution: "allow_once" });
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  assert.equal(hits.page, pages, "a cancelled opening cannot later contact its destination");
  assert.equal(await manager.stillOpen(id), true, "cancelling a separate open did not close the shared page");
  await rules.setBrowser("submit", "allow");
  await manager.actForChat("main", id, { kind: "click", ref: await ref("Save form"), consequential: true, what: "Next owner's submit", why: "A fresh operation should remain usable." });
  assert.equal(hits.posts, 1, "a fresh operation succeeds after the cancelled one was discarded");
  t.diagnostic("AbortSignal cancelled submit, upload and initial visit before approval; resolving stale cards sent no HTTP/write, while the same browser accepted a fresh operation.");
});

test("unavailable Edge configuration ends saved live browsers explicitly", async () => {
  const rules = memoryRules();
  const directory = mkdtempSync(join(tmpdir(), "amuse-native-config-test-"));
  const verified = realpathSync(directory);
  assert.equal(dirname(verified).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(basename(verified).startsWith("amuse-native-config-test-"));
  try {
    const manager = new NativeBrowserManager({ executablePath: join(directory, "missing-edge.exe"), directory, rules });
    const host = createHost({ ...ports(rules), ...manager.ports() }, { store: memoryChats() });
    host.external.ingest("main", [{ kind: "upserted", entity: oldBrowser("missing-native-runtime", "https://example.invalid/") }]);
    assert.deepEqual(await manager.restoreExisting(host), { restored: 0, ended: 1, migratedProfiles: 0 });
    const browser = host.external.state("main").entities.find((entity) => entity.id === "missing-native-runtime");
    assert.ok(browser?.kind === "browser"); assert.equal(browser.live, false); assert.equal(browser.outcome, "failed"); assert.match(browser.result ?? "", /Edge executable is unavailable/);
  } finally { assert.equal(realpathSync(directory), verified); rmSync(verified, { recursive: true, force: true }); }
});
