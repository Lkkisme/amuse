/** A browser page shared by the phone viewer and Codex's scoped MCP tools. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium, request as browserRequest, type APIRequestContext, type BrowserContext, type Page, type CDPSession } from "playwright-core";
import { WebSocket } from "ws";
import { StaleRef, type Browsers, type FileData, type PageView, type Size, type Step } from "@amuse/browser";
import { browserRulesOf, decideBrowser, hostOf, memoryRules, type Rules, type Host, type Ports, type AgentIO } from "@amuse/core";
import { permitStep } from "@amuse/pi";
import type { Browser as BrowserEntity, BrowserAction } from "@amuse/protocol";
import { z } from "zod";
import { consumeBrowserCheckpoint } from "./browser-checkpoint.ts";
import { nativeViewport, sameViewport } from "./native-viewport.ts";

const coordinate = z.number().finite().min(0).max(1);
const Input = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pointer"), action: z.enum(["move", "down", "up"]), x: coordinate, y: coordinate, button: z.number().int().min(0).max(2).default(0), generation: z.number().int() }),
  z.object({ type: z.literal("wheel"), x: coordinate, y: coordinate, deltaX: z.number().finite(), deltaY: z.number().finite(), generation: z.number().int() }),
  z.object({ type: z.literal("key"), action: z.enum(["down", "up"]), key: z.string().max(80), code: z.string().max(80).default(""), modifiers: z.number().int().min(0).max(15).default(0) }),
  z.object({ type: z.literal("text"), text: z.string().max(131072) }),
  z.object({ type: z.literal("navigate"), url: z.string().max(8192) }),
  z.object({ type: z.literal("history"), action: z.enum(["back", "forward", "reload"]) }),
  z.object({ type: z.literal("viewport"), view: z.object({ width: z.number().finite().min(1).max(8000), height: z.number().finite().min(1).max(8000) }) }),
]);
export type NativeStep = { kind: string; consequential?: boolean; what?: string; why?: string; ref?: string; selector?: string; text?: string; clear?: boolean; submit?: boolean; key?: string; url?: string; x?: number; y?: number; button?: "left" | "middle" | "right"; clickCount?: number; direction?: "up" | "down"; deltaX?: number; deltaY?: number };
type Run = { id: string; chat: string; io: AgentIO; page: Page; context: BrowserContext; cdp: CDPSession; held: boolean; generation: number; refs: Set<string>; viewers: Set<WebSocket>; queue: Promise<void>; stream: Promise<void>; streaming: boolean; downloads: FileData[]; closing: boolean; pointer: { x: number; y: number; buttons: number }; keys: Map<string, { key: string; code: string }>; stop: AbortController; granted: Set<string>; policy: Promise<void>; policies: Set<Promise<void>>; downloaded: Set<Promise<void>>; policyError: Error | null; submitGranted: string | null; initialState: LoginState; forgotten: Set<string>; directory: string; preview: APIRequestContext | null; previewSockets: Set<WebSocket>; operationSignal: AbortSignal | undefined };

function webUrl(value: string) {
  const url = new URL(value.includes(":") ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("请输入 http 或 https 网页地址。");
  return url.href;
}

const LoginCookie = z.object({ name: z.string(), value: z.string(), domain: z.string(), path: z.string(), expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(["Strict", "Lax", "None"]) });
const LoginState = z.object({ cookies: z.array(LoginCookie), origins: z.array(z.object({ origin: z.string().url(), localStorage: z.array(z.object({ name: z.string(), value: z.string() })) })) });
type LoginState = z.infer<typeof LoginState>;
const emptyLogins = (): LoginState => ({ cookies: [], origins: [] });
const cookieKey = (cookie: LoginState["cookies"][number]) => `${cookie.domain}\0${cookie.path}\0${cookie.name}`;
const onSite = (domain: string, site: string) => { const host = domain.toLowerCase().replace(/^\./, "").replace(/\.$/, ""); return host === site || host.endsWith(`.${site}`); };
const cookieOnSite = (domain: string, site: string) => onSite(domain, site) || domain.startsWith(".") && site.endsWith(domain.toLowerCase());
const originOnSite = (origin: string, site: string) => { try { return onSite(new URL(origin).hostname, site); } catch { return false; } };

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

export class NativeBrowserManager implements Browsers {
  private runs = new Map<string, Run>();
  private opening = new Map<string, Promise<void>>();
  private launching = 0;
  private cancelled = new Set<string>();
  private host: Host | undefined;
  private options: { executablePath: string; directory: string; maxBrowsers?: number; rules?: Rules; sandboxUrl?: string };
  private rules: Rules;
  private loginQueue: Promise<void> = Promise.resolve();
  private loginState: LoginState;
  private migration: Promise<number> | undefined;
  private openingSignals = new Map<string, AbortSignal>();
  private restoration: Promise<{ restored: number; ended: number; migratedProfiles: number }> | undefined;
  private viewerSizes = new WeakMap<WebSocket, Size>();
  private viewportOwners = new Map<string, WebSocket>();
  private layouts = new Map<string, Promise<void>>();
  private resizing = new Set<string>();
  constructor(options: { executablePath: string; directory: string; maxBrowsers?: number; rules?: Rules; sandboxUrl?: string }) {
    this.options = options;
    this.rules = options.rules ?? memoryRules();
    if (options.sandboxUrl) {
      const url = new URL(options.sandboxUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid sandbox preview daemon URL.");
    }
    mkdirSync(options.directory, { recursive: true });
    const path = join(options.directory, "logins.json");
    this.loginState = existsSync(path) ? LoginState.parse(JSON.parse(readFileSync(path, "utf8"))) : emptyLogins();
  }
  private async recordedBrowsers() {
    if (!this.host) return [];
    const { chats } = await this.host.call("chats.list", {});
    return chats.flatMap((chat) => this.host!.external.state(chat.id).entities.filter((entity): entity is BrowserEntity => entity.kind === "browser").map((browser) => ({ chat: chat.id, browser })));
  }
  private migrateProfiles(): Promise<number> {
    this.migration ??= (async () => {
      const file = join(this.options.directory, "logins.json");
      if (existsSync(file)) { this.loginState = LoginState.parse(JSON.parse(readFileSync(file, "utf8"))); return 0; }
      const root = join(this.options.directory, "profiles");
      if (!existsSync(root)) return 0;
      const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{24}$/.test(entry.name)).map((entry) => join(root, entry.name)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
      if (!directories.length) return 0;
      const history = await this.recordedBrowsers();
      const snapshots: LoginState[] = [];
      for (const directory of directories) {
        const context = await chromium.launchPersistentContext(directory, { executablePath: this.options.executablePath, headless: true, serviceWorkers: "block", args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking"] });
        try {
          // Discover origin storage without contacting the sites or running their
          // JavaScript: these blank documents only unlock existing localStorage.
          await context.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Local login migration</title>" }));
          const origins = new Set<string>();
          for (const { browser } of history) if (digest(browser.id) === basename(directory)) {
            try { origins.add(new URL(webUrl(browser.url)).origin); } catch { /* Non-web legacy entries have no origin storage. */ }
          }
          for (const cookie of await context.cookies()) {
            const domain = cookie.domain.replace(/^\./, "");
            if (domain) origins.add(`${cookie.secure ? "https" : "http"}://${domain}`);
          }
          const page = context.pages()[0] ?? await context.newPage();
          for (const origin of origins) await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 10000 });
          snapshots.push(LoginState.parse(await context.storageState()));
        } finally { await context.close(); }
      }
      await this.loginExclusive(async () => {
        const cookies = new Map(this.loginState.cookies.map((cookie) => [cookieKey(cookie), cookie]));
        const origins = new Map(this.loginState.origins.map((origin) => [origin.origin, origin]));
        for (const snapshot of snapshots) {
          for (const cookie of snapshot.cookies) if (cookie.expires === -1 || cookie.expires > Date.now() / 1000) cookies.set(cookieKey(cookie), cookie);
          for (const origin of snapshot.origins) if (origin.localStorage.length) origins.set(origin.origin, origin);
        }
        this.loginState = { cookies: [...cookies.values()], origins: [...origins.values()] };
        this.saveLogins(); // Old profiles are removed only after durable owner state exists.
      });
      for (const directory of directories) await this.eraseProfile(directory);
      return directories.length;
    })();
    return this.migration;
  }
  private endExisting(chat: string, browser: BrowserEntity, message: string) {
    const io = this.host!.agent(chat);
    const ended = io.act({ kind: "browserEnded", id: browser.id, status: "failed", result: message });
    if (!ended.ok) this.host!.external.ingest(chat, [{ kind: "upserted", entity: { ...browser, status: "idle", outcome: "failed", result: message, step: null, live: false } }]);
    io.act({ kind: "released", id: browser.id });
  }
  /** Reopen saved viewer pages without replaying any agent task. Idempotent. */
  restoreExisting(host?: Host): Promise<{ restored: number; ended: number; migratedProfiles: number }> {
    if (host) this.bind(host);
    if (!this.host) throw new Error("Browser host is not ready.");
    this.restoration ??= (async () => {
      const checkpoint = consumeBrowserCheckpoint(this.options.directory);
      if (checkpoint) for (const entry of checkpoint.browsers) {
        let state;
        try { state = this.host!.external.state(entry.chat); } catch { continue; }
        const current = state.entities.find((entity): entity is BrowserEntity => entity.kind === "browser" && entity.id === entry.browser.id);
        const saved = entry.browser;
        // Only shutdown/recovery changes (live/status/step/title) may be undone.
        // A user stop, a new navigation/job/result or a rolled-back journal is
        // authoritative and can never be revived by an old owner checkpoint.
        if (!current || state.seq < entry.seq || !["paused", "idle"].includes(current.status) || current.at !== saved.at || current.url !== saved.url || current.instructions !== saved.instructions || current.result !== saved.result || current.outcome !== saved.outcome || JSON.stringify(current.files) !== JSON.stringify(saved.files)) continue;
        this.host!.external.ingest(entry.chat, [{ kind: "upserted", entity: { ...current, ...saved, live: true } }]);
      }
      const recorded = await this.recordedBrowsers();
      const live = recorded.filter(({ browser }) => browser.live);
      let restored = 0, ended = 0;
      if (!existsSync(this.options.executablePath)) {
        for (const { chat, browser } of live) { this.endExisting(chat, browser, "The saved browser could not be restored: the configured Edge executable is unavailable."); ended++; }
        return { restored, ended, migratedProfiles: 0 };
      }
      const migratedProfiles = await this.migrateProfiles();
      for (const { chat, browser } of live) {
        if (this.owns(browser.id)) continue;
        if (!["paused", "idle"].includes(browser.status)) { this.endExisting(chat, browser, "This browser's previous agent task was not replayed after the server update. Open a new browser task to continue."); ended++; continue; }
        try {
          const url = new URL(webUrl(browser.url));
          if (url.hostname === "sandbox" && !this.options.sandboxUrl) throw new Error("The sandbox preview service is not configured.");
          if (browser.status === "idle" && decideBrowser(await browserRulesOf(this.rules), url.href, "visit").permission === "deny") {
            const permission = await permitStep({ io: this.host!.agent(chat), rules: this.rules, url: url.href, stop: new AbortController() }, { waiting: () => {}, working: () => {} }, "visit", "Restore browser page", url.href);
            throw new Error(permission.kind === "rule" ? permission.told : "The saved page could not be visited.");
          }
          await this.start(browser, this.host!.agent(chat), true);
          restored++;
        } catch (error) { this.endExisting(chat, browser, `The saved browser could not be restored: ${error instanceof Error ? error.message : String(error)}`); ended++; }
      }
      return { restored, ended, migratedProfiles };
    })();
    return this.restoration;
  }
  private start(browser: BrowserEntity, io: AgentIO, restoring = false): Promise<void> {
    const existing = this.opening.get(browser.id);
    if (existing) return existing;
    if (this.runs.has(browser.id)) return Promise.resolve();
    const promise = this.launch(browser, io, restoring).catch((error) => {
      this.opening.delete(browser.id);
      io.act({ kind: "browserEnded", id: browser.id, status: "failed", result: error instanceof Error ? error.message : String(error) });
      io.act({ kind: "released", id: browser.id });
      throw error;
    });
    this.opening.set(browser.id, promise); void promise.catch(() => {});
    return promise;
  }
  private loginExclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.loginQueue.then(action);
    this.loginQueue = result.then(() => {}, () => {});
    return result;
  }
  private saveLogins() {
    const path = join(this.options.directory, "logins.json");
    writeFileSync(`${path}.next`, JSON.stringify(this.loginState), { mode: 0o600 });
    renameSync(`${path}.next`, path);
  }
  private async eraseProfile(directory: string) {
    const expectedParent = resolve(this.options.directory, "profiles");
    const target = resolve(directory);
    if (dirname(target).toLowerCase() !== expectedParent.toLowerCase() || !/^[a-f0-9]{24}$/.test(basename(target))) throw new Error("Refusing to remove a browser profile outside its owned directory.");
    await rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
  private trackPolicy(run: Run, action: () => Promise<void>) {
    const pending = run.policy.then(action);
    run.policy = pending.catch(() => {});
    run.policies.add(pending);
    void pending.catch((error: unknown) => { run.policyError = error instanceof Error ? error : new Error(String(error)); }).finally(() => run.policies.delete(pending));
    return pending;
  }
  private async permit(run: Run, url: string, action: BrowserAction, what: string, why: string, requireAgent = true) {
    if (requireAgent) this.assertAgent(run);
    const decision = decideBrowser(await browserRulesOf(this.rules), url, action);
    const host = hostOf(url);
    if (action === "visit" && decision.permission === "ask" && host && run.granted.has(host)) return;
    const stop = new AbortController();
    const signals = [run.stop.signal, run.operationSignal].filter((signal): signal is AbortSignal => signal !== undefined);
    const aborted = () => stop.abort();
    for (const signal of signals) { if (signal.aborted) stop.abort(); else signal.addEventListener("abort", aborted, { once: true }); }
    let result: Awaited<ReturnType<typeof permitStep>>;
    try {
      result = await permitStep({ io: run.io, rules: this.rules, url, stop }, {
        waiting: () => { if (!run.held && !run.closing) run.io.act({ kind: "browserStatus", id: run.id, status: "waiting" }); },
        working: () => { if (!run.held && !run.closing) run.io.act({ kind: "browserStatus", id: run.id, status: "working" }); },
      }, action, what, why);
    } finally { for (const signal of signals) signal.removeEventListener("abort", aborted); }
    if (result.kind !== "yes") throw new Error(result.kind === "rule" ? result.told : result.kind === "stopped" ? "Browser action stopped before approval." : `The user did not approve ${what}. Do not work around this refusal.`);
    if (requireAgent) this.assertAgent(run);
    if (action === "visit" && host) run.granted.add(host);
  }
  private previewUrl(logical: URL) {
    if (!this.options.sandboxUrl) throw new Error("The sandbox preview service is not configured.");
    const port = Number(logical.port || (logical.protocol === "https:" || logical.protocol === "wss:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 7070) throw new Error("The sandbox control port cannot be opened as a webpage.");
    const target = new URL(`/preview/${port}${logical.pathname}${logical.search}`, this.options.sandboxUrl);
    if (logical.protocol === "ws:" || logical.protocol === "wss:") target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    return target;
  }
  private async previewResponse(run: Run, request: { url: string; method: string; headers: Record<string, string>; postData?: string; postDataEntries?: { bytes?: string }[] }) {
    const logical = new URL(request.url);
    let response: Awaited<ReturnType<APIRequestContext["fetch"]>> | undefined;
    try {
      const target = this.previewUrl(logical);
      const original = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]));
      const headers = Object.fromEntries(Object.entries(original).filter(([key]) => !["host", "origin", "referer", "connection", "content-length"].includes(key) && !key.startsWith("sec-fetch-")));
      // This API context has no browser cookies. An explicit source Cookie
      // header also keeps previews isolated from the daemon's loopback origin.
      headers["cookie"] = original["cookie"] ?? "";
      run.preview ??= await browserRequest.newContext();
      const body = request.postDataEntries?.some((entry) => entry.bytes) ? Buffer.concat(request.postDataEntries.map((entry) => Buffer.from(entry.bytes ?? "", "base64"))) : request.postData;
      response = await run.preview.fetch(target.href, { method: request.method, headers, data: body, maxRedirects: 0, timeout: 30000 });
      const outgoing = Object.fromEntries(Object.entries(response.headers()).filter(([key]) => !["connection", "content-length", "content-encoding", "transfer-encoding"].includes(key)));
      if (outgoing["location"]) {
        const redirect = new URL(outgoing["location"], logical);
        if (["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname) && (redirect.port || "80") === (logical.port || "80")) { redirect.hostname = "sandbox"; outgoing["location"] = redirect.href; }
      }
      return { responseCode: response.status(), responseHeaders: Object.entries(outgoing).flatMap(([name, value]) => (name === "set-cookie" ? value.split("\n") : [value]).map((value) => ({ name, value }))), body: (await response.body()).toString("base64") };
    } catch (error) {
      return { responseCode: 502, responseHeaders: [{ name: "content-type", value: "text/plain; charset=utf-8" }], body: Buffer.from(error instanceof Error ? error.message : "The sandbox preview could not be reached.").toString("base64") };
    } finally { await response?.dispose().catch(() => {}); }
  }
  private async previewRoutes(run: Run) {
    const context = run.context;
    // Initialize once before any page resources race to use the preview proxy.
    if (this.options.sandboxUrl) run.preview = await browserRequest.newContext();
    await context.routeWebSocket((url) => url.hostname === "sandbox", async (route) => {
      let remote: WebSocket | undefined;
      const buffered: (string | Buffer)[] = [];
      let size = 0;
      let closed = false;
      route.onMessage((message) => {
        if (closed) return;
        if (remote?.readyState === WebSocket.OPEN) remote.send(message);
        else if ((size += Buffer.byteLength(message)) <= 1024 * 1024) buffered.push(message);
        else { closed = true; void route.close({ code: 1000, reason: "Preview connection buffer exceeded." }); remote?.terminate(); }
      });
      route.onClose(() => { closed = true; remote?.close(); });
      try {
        const logical = new URL(route.url());
        const target = this.previewUrl(logical);
        const policyUrl = new URL(logical); policyUrl.protocol = policyUrl.protocol === "wss:" ? "https:" : "http:";
        if (!run.held) await this.trackPolicy(run, () => this.permit(run, policyUrl.href, "visit", "Open sandbox preview connection", policyUrl.href));
        if (closed || run.closing) return;
        remote = new WebSocket(target, route.protocols());
        run.previewSockets.add(remote);
        remote.on("open", () => { for (const message of buffered) remote!.send(message); buffered.length = 0; });
        remote.on("message", (data, binary) => { if (!closed) route.send(binary ? Buffer.from(data as Buffer) : data.toString()); });
        remote.on("close", () => { run.previewSockets.delete(remote!); if (!closed) { closed = true; void route.close({ code: 1000, reason: "Preview connection closed." }); } });
        remote.on("error", () => { if (!closed) { closed = true; void route.close({ code: 1000, reason: "The sandbox preview connection failed." }); } });
      } catch (error) { closed = true; await route.close({ code: 1000, reason: error instanceof Error ? error.message.slice(0, 100) : "The sandbox preview connection failed." }).catch(() => {}); }
    });
  }
  private async guardRequest(run: Run, request: { url(): string; method(): string; isNavigationRequest(): boolean }) {
    if (run.held) return; // A held browser receives direct human input, gated by /live.
    this.assertAgent(run);
    const url = request.url();
    if (!/^https?:/.test(url)) return;
    const rules = await browserRulesOf(this.rules);
    const navigation = request.isNavigationRequest();
    // Denied sites are blocked before their requests leave this isolated browser,
    // including subframes, redirects, script navigation and background resources.
    if (navigation || decideBrowser(rules, url, "visit").permission === "deny") {
      await this.permit(run, url, "visit", "Visit", `${url}\nThe current page is opening this address.`);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      const decision = decideBrowser(await browserRulesOf(this.rules), url, "submit");
      if (run.submitGranted !== new URL(url).origin || decision.permission === "deny") await this.permit(run, url, "submit", "Submit browser request", `${request.method()} ${url}\nThe page is sending information or changing server state.`);
    }
    this.assertAgent(run);
  }
  bind(host: Host) { this.host = host; }
  owns = (id: string) => this.runs.has(id) || this.opening.has(id);
  private async run(id: string) { await this.opening.get(id); const run = this.runs.get(id); if (!run) throw new Error("此浏览器已关闭。"); return run; }
  private assertScope(run: Run, chat: string) { if (run.chat !== chat) throw new Error("该浏览器属于另一个会话。"); }
  private checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("The browser operation was cancelled.", "AbortError"); }
  private assertAgent(run: Run) { this.checkSignal(run.operationSignal); if (run.closing) throw new Error("此浏览器已关闭。"); if (run.held) throw new Error("用户正在手机或网页端接管这个浏览器。请停止操作，等待用户点击 Done／交还控制权；不要改用其他工具绕过接管。"); }
  private beginJob(run: Run) {
    this.assertAgent(run);
    const entity = this.host?.external.state(run.chat).entities.find((item) => item.id === run.id);
    if (entity?.kind === "browser" && entity.status === "idle") {
      const result = run.io.act({ kind: "browserJob", id: run.id, title: entity.title, instructions: "在当前 Amuse 聊天的同一浏览器中执行用户任务。", files: entity.files });
      if (!result.ok) throw new Error(`无法开始浏览器任务：${JSON.stringify(result.rejection)}`);
    }
  }
  private exclusive<T>(run: Run, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const result = run.queue.then(async () => {
      this.checkSignal(signal);
      const previous = run.operationSignal;
      run.operationSignal = signal;
      try { this.assertAgent(run); const value = await action(); this.checkSignal(signal); return value; }
      finally { run.operationSignal = previous; }
    });
    run.queue = result.then(() => {}, () => {});
    return result;
  }
  private ready(run: Run) { const size = run.page.viewportSize() ?? { width: 1024, height: 768 }; return { type: "ready", transport: "native" as const, viewportControl: "viewer" as const, frames: "tagged" as const, ...size, generation: run.generation, url: run.page.url(), title: "Browser" }; }
  private notify(run: Run) { const message = JSON.stringify(this.ready(run)); for (const viewer of run.viewers) if (viewer.readyState === WebSocket.OPEN) viewer.send(message); }
  private frame(run: Run, bytes: Buffer, viewport: Size, generation: number, only?: WebSocket) {
    if (this.resizing.has(run.id) || run.generation !== generation || !sameViewport(viewport, run.page.viewportSize() ?? { width: 1024, height: 768 })) return;
    const header = JSON.stringify({ type: "frame", ...viewport, generation });
    for (const viewer of only ? [only] : run.viewers) if (viewer.readyState === WebSocket.OPEN && viewer.bufferedAmount < 512 * 1024) {
      // Ordered websocket messages bind each JPEG to its layout, including async decoder work.
      viewer.send(header); viewer.send(bytes, { binary: true });
    }
  }
  private async snapshot(run: Run, only?: WebSocket) {
    const metadata = this.ready(run);
    const image = await run.page.screenshot({ type: "jpeg", quality: 75 });
    this.frame(run, image, metadata, metadata.generation, only);
  }
  private layout(run: Run, viewer: Size | null) {
    const result = (this.layouts.get(run.id) ?? Promise.resolve()).then(async () => {
      if (run.closing) return;
      const size = viewer ? nativeViewport(viewer) : { width: 1024, height: 768 };
      if (sameViewport(run.page.viewportSize() ?? size, size)) return;
      this.resizing.add(run.id);
      try {
        await this.releaseInput(run);
        await run.page.setViewportSize(size);
        run.generation++;
        this.notify(run);
      } finally { this.resizing.delete(run.id); }
      // A static page need not repaint after a resize, so provide an exact fresh frame too.
      await this.snapshot(run);
    });
    this.layouts.set(run.id, result.catch(() => {}));
    return result;
  }
  private updateStream(run: Run) {
    const result = run.stream.then(async () => {
      if (run.closing) return;
      // All viewers of one page share its one CDP stream. Recheck after prior
      // starts/stops settle, including reconnects while the last viewer leaves.
      if (run.viewers.size > 0 && !run.streaming) {
        await run.cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, maxWidth: 1280, maxHeight: 1920, everyNthFrame: 1 });
        run.streaming = true;
      } else if (run.viewers.size === 0 && run.streaming) {
        await run.cdp.send("Page.stopScreencast"); run.streaming = false;
      }
    });
    run.stream = result.catch(() => {}); return result;
  }
  private async releaseInput(run: Run) {
    for (const key of run.keys.values()) await run.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key }).catch(() => {});
    run.keys.clear();
    for (const [button, mask] of [["left", 1], ["middle", 4], ["right", 2]] as const) if (run.pointer.buttons & mask) {
      run.pointer.buttons &= ~mask;
      await run.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: run.pointer.x, y: run.pointer.y, buttons: run.pointer.buttons, button, clickCount: 1 }).catch(() => {});
    }
  }
  private async metadata(run: Run) {
    if (run.closing || run.page.isClosed()) return;
    const title = await run.page.title().catch(() => "");
    if (run.closing || run.page.isClosed()) return;
    const state = this.host?.external.state(run.chat);
    const entity = state?.entities.find((e) => e.id === run.id);
    if (entity?.kind === "browser") this.host?.external.ingest(run.chat, [{ kind: "upserted", entity: { ...entity, url: run.page.url().startsWith("http") ? run.page.url() : entity.url, title: title || entity.title } }]);
    this.notify(run);
    if (run.viewers.size) await this.snapshot(run);
  }
  ports(): Pick<Ports, "browse" | "browser" | "job" | "fit"> {
    return {
      browse: (browser, io) => { void this.start(browser, io); },
      browser: ({ browser, action }) => {
        if (action === "stop") this.cancelled.add(browser.id);
        const run = this.runs.get(browser.id); if (!run) return;
        run.held = action === "take";
        if (action === "handBack") { this.viewportOwners.delete(run.id); void this.layout(run, null).catch(() => {}); }
        if (run.held || action === "stop") run.stop.abort();
        else run.stop = new AbortController();
        if (action === "stop") { void this.close(browser.id).catch(() => {}); return; }
        run.queue = run.queue.then(async () => { await this.releaseInput(run); if (action === "handBack") await this.remember(browser.id); }).catch(() => {});
        this.notify(run);
      },
      job: () => {},
      fit: ({ id, viewer }) => { void this.fit(id, viewer).catch(() => {}); },
    };
  }
  private async launch(browser: BrowserEntity, io: AgentIO, restoring = false) {
    await this.migrateProfiles();
    if (this.runs.size + this.launching >= (this.options.maxBrowsers ?? 2)) throw new Error("浏览器数量已达上限，请先关闭一个。");
    this.launching++;
    const directory = join(this.options.directory, "profiles", digest(browser.id));
    let context: BrowserContext;
    try { context = await chromium.launchPersistentContext(directory, { executablePath: this.options.executablePath, headless: true, viewport: { width: 1024, height: 768 }, acceptDownloads: true, serviceWorkers: "block", downloadsPath: join(this.options.directory, "downloads"), args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking"] }); }
    finally { this.launching--; }
    try {
      if (this.cancelled.has(browser.id)) throw new Error("浏览器已关闭。");
      const page = context.pages()[0] ?? await context.newPage();
      const cdp = await context.newCDPSession(page);
      const run: Run = { id: browser.id, chat: io.chat, io, page, context, cdp, held: browser.status === "paused", generation: 1, refs: new Set(), viewers: new Set(), queue: Promise.resolve(), stream: Promise.resolve(), streaming: false, downloads: [], closing: false, pointer: { x: 0, y: 0, buttons: 0 }, keys: new Map(), stop: new AbortController(), granted: new Set(), policy: Promise.resolve(), policies: new Set(), downloaded: new Set(), policyError: null, submitGranted: null, initialState: emptyLogins(), forgotten: new Set(), directory, preview: null, previewSockets: new Set(), operationSignal: this.openingSignals.get(browser.id) };
      await this.loginExclusive(async () => {
        run.initialState = structuredClone(this.loginState);
        await context.setStorageState(run.initialState);
        this.runs.set(browser.id, run);
      });
      // Playwright route() only sees the first request in an HTTP redirect
      // chain. CDP Fetch pauses every hop before it reaches the network.
      cdp.on("Fetch.requestPaused", (event) => {
        void (async () => {
          try {
            await this.trackPolicy(run, () => this.guardRequest(run, { url: () => event.request.url, method: () => event.request.method, isNavigationRequest: () => event.resourceType === "Document" }));
            if (new URL(event.request.url).hostname === "sandbox") {
              // Fulfilling at CDP level also covers every redirect hop; a
              // Playwright route only sees the first URL in a redirect chain.
              const response = await this.previewResponse(run, event.request);
              await cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, ...response });
            } else await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
          } catch { await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }).catch(() => {}); }
        })();
      });
      await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      await this.previewRoutes(run);
      context.on("page", (extra) => { if (extra !== run.page) void extra.close().catch(() => {}); });
      cdp.on("Page.screencastFrame", (event) => {
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
        this.frame(run, Buffer.from(event.data, "base64"), { width: event.metadata.deviceWidth, height: event.metadata.deviceHeight }, run.generation);
      });
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) { run.refs.clear(); run.generation++; void this.metadata(run).catch(() => {}); } });
      page.on("load", () => { void this.metadata(run).catch(() => {}); });
      page.on("close", () => { if (!run.closing) void this.close(run.id).catch(() => {}); });
      page.on("download", (download) => {
        const human = run.held;
        const pending = (async () => {
          if (!human) await this.trackPolicy(run, () => this.permit(run, /^https?:/.test(download.url()) ? download.url() : run.page.url(), "download", `Download ${download.suggestedFilename()}`, `Keep ${download.suggestedFilename()} from this page.`));
          const path = await download.path();
          if (path) { const { readFile } = await import("node:fs/promises"); run.downloads.push({ name: download.suggestedFilename(), data: await readFile(path) }); }
        })().catch(async () => { await download.cancel().catch(() => {}); }).finally(async () => { await download.delete().catch(() => {}); run.downloaded.delete(pending); });
        run.downloaded.add(pending);
      });
      const load = async () => {
        await page.goto(webUrl(browser.url), { waitUntil: "domcontentloaded", timeout: 0 }).catch((error: unknown) => { if (!run.held || this.cancelled.has(browser.id)) throw run.policyError ?? error; });
        if (run.policyError && !run.held) throw run.policyError;
        if (this.cancelled.has(browser.id)) throw new Error("浏览器已关闭。");
        await this.metadata(run);
      };
      // The HTTP listener must come up before a saved idle page asks the user
      // for permission. Its blank viewer is live while the normal card waits.
      if (restoring && browser.status === "idle" && decideBrowser(await browserRulesOf(this.rules), webUrl(browser.url), "visit").permission === "ask") {
        void load().catch(async (error: unknown) => { this.endExisting(run.chat, browser, error instanceof Error ? error.message : String(error)); await this.close(run.id).catch(() => {}); });
      } else await load();
    } catch (error) { await context.close().catch(() => {}); this.runs.delete(browser.id); await this.eraseProfile(directory); throw error; }
  }
  async open(): Promise<void> { throw new Error("Use the authenticated Amuse browser.open command."); }
  async waitReady(id: string) { await this.run(id); }
  async openForChat(chat: string, url: string) {
    if (!this.host) throw new Error("Browser host is not ready.");
    const result = await this.host.call("browser.open", { chat, url: webUrl(url) });
    await this.run(result.id);
    return result;
  }
  async openForAgent(chat: string, url: string, signal?: AbortSignal) {
    this.checkSignal(signal);
    if (!this.host) throw new Error("Browser host is not ready.");
    const result = this.host.agent(chat).act({ kind: "browse", title: "Browser", url: webUrl(url), instructions: "Use this shared Amuse browser for the user's task.", files: [] });
    if (!result.ok) throw new Error(`Cannot open the browser: ${JSON.stringify(result.rejection)}`);
    if (signal) this.openingSignals.set(result.id, signal);
    try { await this.run(result.id); this.checkSignal(signal); return { id: result.id }; }
    finally { this.openingSignals.delete(result.id); const run = this.runs.get(result.id); if (run && run.operationSignal === signal) run.operationSignal = undefined; }
  }
  list(chat: string) { return [...this.runs.values()].filter((run) => run.chat === chat).map((run) => ({ id: run.id, url: run.page.url(), controlledBy: run.held ? "user" : "agent" })); }
  async info(id: string) { const run = await this.run(id); return { transport: "native" as const, ...(run.page.viewportSize() ?? { width: 1024, height: 768 }) }; }
  async look(id: string): Promise<PageView> {
    const run = await this.run(id); this.assertAgent(run);
    await this.trackPolicy(run, () => this.permit(run, run.page.url(), "visit", "Read page", run.page.url()));
    const prefix = `a${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const view = await run.page.evaluate((prefix) => {
      let index = 0;
      const elements = Array.from(document.querySelectorAll<HTMLElement>('a,button,input,textarea,select,img,canvas,video,[role="button"],[role="link"],[role="img"],[contenteditable="true"]')).filter((element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== "hidden"; }).map((element) => {
        const ref = `${prefix}-${++index}`; element.setAttribute("data-amuse-ref", ref);
        return { ref, role: element.getAttribute("role") || element.tagName.toLowerCase(), label: element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("placeholder") || element.innerText || element.getAttribute("name") || element.tagName.toLowerCase(), href: element instanceof HTMLAnchorElement ? element.href : null, disabled: element.hasAttribute("disabled") };
      });
      return { url: location.href, title: document.title, text: document.body.innerText, elements };
    }, prefix);
    run.refs = new Set(view.elements.map((element) => element.ref)); return view;
  }
  async observeForChat(chat: string, id: string, signal?: AbortSignal) { this.checkSignal(signal); const run = await this.run(id); this.assertScope(run, chat); return this.exclusive(run, () => this.look(id), signal); }
  async actForChat(chat: string, id: string, step: NativeStep, signal?: AbortSignal) { this.checkSignal(signal); const run = await this.run(id); this.assertScope(run, chat); return this.exclusive(run, async () => { await this.act(run, step); this.assertAgent(run); return this.look(id); }, signal); }
  async step(id: string, step: Step) { const run = await this.run(id); await this.exclusive(run, () => this.act(run, step)); }
  private async act(run: Run, step: NativeStep) {
    this.assertAgent(run);
    this.beginJob(run);
    run.policyError = null;
    await this.trackPolicy(run, () => this.permit(run, run.page.url(), "visit", "Read current page", run.page.url()));
    if (step.consequential && (!step.what?.trim() || !step.why?.trim())) throw new Error("A consequential browser step needs what and why for the user's approval card.");
    if (step.kind === "navigate") await this.trackPolicy(run, () => this.permit(run, webUrl(step.url ?? ""), "visit", step.what || "Visit", step.why || webUrl(step.url ?? "")));
    if (step.consequential) await this.trackPolicy(run, () => this.permit(run, run.page.url(), "submit", step.what!, step.why!));
    this.assertAgent(run);
    run.submitGranted = step.consequential ? new URL(run.page.url()).origin : null;
    try {
    const locator = step.ref ? (() => { if (!run.refs.has(step.ref!)) throw new Error("页面引用已过期，请重新 observe。"); return run.page.locator(`[data-amuse-ref="${step.ref}"]`); })() : step.selector ? run.page.locator(step.selector) : undefined;
    const target = locator ?? (step.kind === "press" ? run.page.locator(":focus") : undefined);
    const possible = target ? await target.evaluate((element) => {
      const anchor = element.closest("a");
      const control = element as HTMLInputElement | HTMLButtonElement;
      const form = control.form ?? element.closest("form");
      return { href: anchor?.href ?? null, formAction: form?.action ?? null, formMethod: form?.method.toUpperCase() ?? "GET", submitButton: element instanceof HTMLButtonElement ? element.type === "submit" : element instanceof HTMLInputElement && ["submit", "image"].includes(element.type) };
    }).catch(() => null) : null;
    const formSubmit = possible && possible.formMethod !== "GET" && (step.kind === "click" && possible.submitButton || step.kind === "type" && step.submit || step.kind === "press" && (step.key ?? "Enter") === "Enter");
    if (possible?.href && step.kind === "click" && /^https?:/.test(possible.href)) await this.trackPolicy(run, () => this.permit(run, possible.href!, "visit", "Visit linked page", possible.href!));
    if (formSubmit && !step.consequential) {
      await this.trackPolicy(run, () => this.permit(run, possible.formAction || run.page.url(), "submit", step.what || "Submit form", step.why || "The browser control submits this page's form."));
      run.submitGranted = new URL(possible.formAction || run.page.url()).origin;
    }
    this.assertAgent(run);
    if (step.kind === "navigate") await run.page.goto(webUrl(step.url ?? ""), { waitUntil: "domcontentloaded", timeout: 0 }).catch((error: unknown) => { throw run.policyError ?? error; });
    else if (step.kind === "click") {
      if (locator) { await locator.click({ trial: true, timeout: 5000 }); this.assertAgent(run); await locator.click({ button: step.button ?? "left", clickCount: step.clickCount ?? 1, force: true, noWaitAfter: false, timeout: 0 }); }
      else { this.assertAgent(run); await run.page.mouse.click(step.x ?? 0, step.y ?? 0, { button: step.button ?? "left", clickCount: step.clickCount ?? 1 }); }
    } else if (step.kind === "type") { if (locator) { this.assertAgent(run); if (step.clear !== false) await locator.fill(step.text ?? "", { timeout: 1000 }); else { await locator.focus(); this.assertAgent(run); await run.page.keyboard.insertText(step.text ?? ""); } if (step.submit) { this.assertAgent(run); await locator.press("Enter"); } } else await run.page.keyboard.insertText(step.text ?? ""); }
    else if (step.kind === "press") await run.page.keyboard.press(step.key ?? "Enter");
    else if (step.kind === "scroll") await run.page.mouse.wheel(step.deltaX ?? 0, step.deltaY ?? (step.direction === "up" ? -500 : 500));
    else throw new Error("Unknown browser action.");
    // Browser events can arrive just after the input command returns (XHR, a
    // script navigation or download). Let this turn deliver them before reporting.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    await Promise.allSettled([...run.policies, ...run.downloaded]);
    if (run.policyError) throw run.policyError;
    await this.metadata(run);
    } finally { run.submitGranted = null; }
  }
  async screenshot(id: string, ref?: string): Promise<Uint8Array | null> {
    const run = this.runs.get(id);
    if (!run || run.page.isClosed()) return null;
    if (!ref) return new Uint8Array(await run.page.screenshot({ type: "png" }));
    this.assertAgent(run);
    if (!run.refs.has(ref)) throw new StaleRef(ref);
    // Only refs from the latest observed page may be pictured; no invented selector or navigation.
    const element = run.page.locator(`[data-amuse-ref="${ref}"]`);
    return new Uint8Array(await element.screenshot({ type: "png", timeout: 5000 }));
  }
  holds(id: string): boolean { return this.runs.has(id); }
  async screenshotForChat(chat: string, id: string, signal?: AbortSignal, ref?: string) { this.checkSignal(signal); const run = await this.run(id); this.assertScope(run, chat); return this.exclusive(run, async () => { await this.trackPolicy(run, () => this.permit(run, run.page.url(), "visit", "Read page image", run.page.url())); this.assertAgent(run); const picture = await this.screenshot(id, ref); if (!picture) throw new Error("Browser image is unavailable."); return picture; }, signal); }
  async finishForChat(chat: string, id: string, result: string, signal?: AbortSignal) { this.checkSignal(signal); const run = await this.run(id); this.assertScope(run, chat); return this.exclusive(run, async () => { this.assertAgent(run); this.beginJob(run); const ended = run.io.act({ kind: "browserEnded", id, status: "completed", result }); if (!ended.ok) throw new Error(`无法结束浏览器任务：${JSON.stringify(ended.rejection)}`); }, signal); }
  async remember(id: string) {
    const run = await this.run(id);
    await this.loginExclusive(async () => {
      const current = LoginState.parse(await run.context.storageState());
      const forgotten = (domain: string) => [...run.forgotten].some((site) => cookieOnSite(domain, site));
      const before = new Map(run.initialState.cookies.map((cookie) => [cookieKey(cookie), cookie]));
      const now = new Map(current.cookies.filter((cookie) => !forgotten(cookie.domain)).map((cookie) => [cookieKey(cookie), cookie]));
      const shared = new Map(this.loginState.cookies.map((cookie) => [cookieKey(cookie), cookie]));
      for (const [key, cookie] of before) if (!now.has(key) && !forgotten(cookie.domain)) shared.delete(key);
      for (const [key, cookie] of now) if (JSON.stringify(before.get(key)) !== JSON.stringify(cookie)) shared.set(key, cookie);
      const oldOrigins = new Map(run.initialState.origins.map((origin) => [origin.origin, origin]));
      const origins = new Map(this.loginState.origins.map((origin) => [origin.origin, origin]));
      for (const origin of current.origins) if (![...run.forgotten].some((site) => originOnSite(origin.origin, site)) && JSON.stringify(oldOrigins.get(origin.origin)) !== JSON.stringify(origin)) origins.set(origin.origin, origin);
      this.loginState = { cookies: [...shared.values()], origins: [...origins.values()] };
      this.saveLogins();
      run.initialState = current;
    });
  }
  async logins() {
    await this.loginQueue;
    const sites = new Map<string, number>();
    for (const cookie of this.loginState.cookies) {
      if (cookie.expires !== -1 && cookie.expires <= Date.now() / 1000) continue;
      const site = cookie.domain.toLowerCase().replace(/^\./, "");
      sites.set(site, (sites.get(site) ?? 0) + 1);
    }
    return [...sites].sort(([a], [b]) => a.localeCompare(b)).map(([site, cookies]) => ({ site, cookies }));
  }
  async forgetLogin(value: string) {
    const site = value.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(site)) throw new Error("Invalid saved-login site.");
    await this.loginExclusive(async () => {
      this.loginState.cookies = this.loginState.cookies.filter((cookie) => !cookieOnSite(cookie.domain, site));
      this.loginState.origins = this.loginState.origins.filter((origin) => !originOnSite(origin.origin, site));
      this.saveLogins();
      for (const run of this.runs.values()) {
        run.forgotten.add(site); // A stale open page must never save this login back.
        for (const cookie of await run.context.cookies()) if (cookieOnSite(cookie.domain, site)) await run.context.clearCookies({ domain: cookie.domain, name: cookie.name, path: cookie.path });
        const current = await run.context.storageState();
        const origins = new Set(current.origins.filter((origin) => originOnSite(origin.origin, site)).map((origin) => origin.origin));
        if (originOnSite(run.page.url(), site)) origins.add(new URL(run.page.url()).origin);
        for (const origin of origins) await run.cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,indexeddb,cache_storage,service_workers" });
        run.initialState.cookies = run.initialState.cookies.filter((cookie) => !cookieOnSite(cookie.domain, site));
        run.initialState.origins = run.initialState.origins.filter((origin) => !originOnSite(origin.origin, site));
      }
    });
  }
  async fit(id: string, viewer: Size | null) {
    const run = await this.run(id);
    // Old read-only web clients use this global RPC. They cannot resize a human's page.
    if (run.held) return;
    await this.layout(run, viewer);
  }
  async close(id: string) { this.cancelled.add(id); const run = this.runs.get(id); if (!run || run.closing) return; run.closing = true; run.stop.abort(); for (const connection of run.previewSockets) connection.terminate(); await run.preview?.dispose().catch(() => {}); for (const viewer of run.viewers) viewer.close(1000, "browser closed"); try { await this.remember(id); } finally { try { await run.context.close(); } finally { this.runs.delete(id); this.opening.delete(id); run.io.act({ kind: "released", id }); await this.eraseProfile(run.directory); } } }
  vnc() { return null; }
  async upload(id: string, ref: string, file: FileData, signal?: AbortSignal) {
    this.checkSignal(signal);
    const run = await this.run(id);
    await this.exclusive(run, async () => {
      this.assertAgent(run);
      if (!run.refs.has(ref)) throw new Error("请重新观察页面。");
      await this.trackPolicy(run, () => this.permit(run, run.page.url(), "upload", `Upload ${file.name}`, `Send ${file.name} to this page.`, true));
      this.assertAgent(run);
      await run.page.locator(`[data-amuse-ref="${ref}"]`).setInputFiles({ name: file.name, mimeType: "application/octet-stream", buffer: Buffer.from(file.data) });
    }, signal);
  }
  async downloads(id: string) { const run = await this.run(id); await Promise.allSettled([...run.downloaded]); return run.downloads.splice(0); }
  async stillOpen(id: string) { return this.runs.has(id) && !this.runs.get(id)!.page.isClosed(); }
  attach = (viewer: WebSocket, id: string, controlled: () => boolean) => {
    let attached: Run | undefined;
    const sendError = (message: string) => { if (viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify({ type: "error", message })); };
    void this.run(id).then(async (run) => {
      if (viewer.readyState !== WebSocket.OPEN) return;
      attached = run; run.viewers.add(viewer); this.notify(run);
      await this.updateStream(run);
      await this.snapshot(run, viewer);
    }).catch((error) => sendError(error instanceof Error ? error.message : String(error)));
    viewer.on("message", (data, binary) => {
      if (binary || data.toString().length > 256 * 1024) return;
      let input: z.infer<typeof Input>;
      try { input = Input.parse(JSON.parse(data.toString())); } catch { sendError("无效的浏览器输入。"); return; }
      const run = attached; if (!run) return;
      if (input.type === "viewport") {
        this.viewerSizes.set(viewer, input.view);
        if (!controlled() || !run.held) return;
        const owner = this.viewportOwners.get(id);
        if (!owner || owner.readyState !== WebSocket.OPEN) this.viewportOwners.set(id, viewer);
        if (this.viewportOwners.get(id) === viewer) void this.layout(run, input.view).catch((error) => sendError(String(error)));
        return;
      }
      // Check when queued AND when executed. A stale UI cannot grant itself control.
      if (!controlled() || !run.held) { sendError("请先点击接管，再操作浏览器。"); return; }
      run.queue = run.queue.then(async () => {
        if (!controlled() || !run.held) return;
        if ("generation" in input && input.generation !== run.generation) return;
        // Only real user input switches the active viewport. A passive viewer never does.
        if ((input.type === "pointer" && input.action === "down") || input.type === "text" || input.type === "navigate" || input.type === "history") {
          const size = this.viewerSizes.get(viewer);
          if (size && this.viewportOwners.get(id) !== viewer) {
            this.viewportOwners.set(id, viewer);
            await this.layout(run, size);
            // The old pointer coordinates describe the previous layout; require a fresh tap.
            if (input.type === "pointer") return;
          }
        }
        const size = run.page.viewportSize() ?? { width: 1024, height: 768 };
        if (input.type === "pointer") {
          const mask = [1, 4, 2][input.button] ?? 1;
          if (input.action === "down") run.pointer.buttons |= mask;
          if (input.action === "up") run.pointer.buttons &= ~mask;
          run.pointer.x = input.x * size.width; run.pointer.y = input.y * size.height;
          await run.cdp.send("Input.dispatchMouseEvent", { type: input.action === "move" ? "mouseMoved" : input.action === "down" ? "mousePressed" : "mouseReleased", ...run.pointer, button: input.action === "move" && !run.pointer.buttons ? "none" : (["left", "middle", "right"] as const)[input.button] ?? "left", clickCount: input.action === "move" ? 0 : 1 });
        }
        else if (input.type === "wheel") await run.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: input.x * size.width, y: input.y * size.height, deltaX: input.deltaX, deltaY: input.deltaY });
        else if (input.type === "text") await run.cdp.send("Input.insertText", { text: input.text });
        else if (input.type === "key") {
          const identity = input.code || input.key;
          if (input.action === "down") run.keys.set(identity, { key: input.key, code: input.code }); else run.keys.delete(identity);
          const virtual = ({ Enter: 13, Tab: 9, Backspace: 8, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35 } as Record<string, number>)[input.key] ?? (input.key.length === 1 ? input.key.toUpperCase().charCodeAt(0) : 0);
          await run.cdp.send("Input.dispatchKeyEvent", { type: input.action === "down" ? "keyDown" : "keyUp", key: input.key, code: input.code, modifiers: input.modifiers, windowsVirtualKeyCode: virtual, ...(input.action === "down" && input.key.length === 1 && !(input.modifiers & 6) ? { text: input.key } : {}) });
        } else if (input.type === "navigate") await run.page.goto(webUrl(input.url), { waitUntil: "domcontentloaded" });
        else if (input.type === "history") { if (input.action === "back") await run.page.goBack(); else if (input.action === "forward") await run.page.goForward(); else await run.page.reload(); }
      }).catch((error) => sendError(error instanceof Error ? error.message : String(error)));
    });
    viewer.on("close", () => {
      if (!attached) return;
      const run = attached; run.viewers.delete(viewer); this.viewerSizes.delete(viewer);
      // Leaving a spectator does not reset the remaining human viewer to a desktop size.
      if (this.viewportOwners.get(id) === viewer) this.viewportOwners.delete(id);
      void this.updateStream(run).catch(() => {});
      if (run.viewers.size === 0) run.queue = run.queue.then(() => this.releaseInput(run));
    });
  };
  async shutdown() { await Promise.allSettled([...this.runs.keys()].map((id) => this.close(id))); }
}
