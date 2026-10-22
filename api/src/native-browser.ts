/** A browser page shared by the phone viewer and Codex's scoped MCP tools. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page, type CDPSession } from "playwright-core";
import { WebSocket } from "ws";
import { fitted, type Browsers, type FileData, type PageView, type Size, type Step } from "@amuse/browser";
import type { Host, Ports, AgentIO } from "@amuse/core";
import type { Browser as BrowserEntity } from "@amuse/protocol";
import { z } from "zod";

const coordinate = z.number().finite().min(0).max(1);
const Input = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pointer"), action: z.enum(["move", "down", "up"]), x: coordinate, y: coordinate, button: z.number().int().min(0).max(2).default(0), generation: z.number().int() }),
  z.object({ type: z.literal("wheel"), x: coordinate, y: coordinate, deltaX: z.number().finite(), deltaY: z.number().finite(), generation: z.number().int() }),
  z.object({ type: z.literal("key"), action: z.enum(["down", "up"]), key: z.string().max(80), code: z.string().max(80).default(""), modifiers: z.number().int().min(0).max(15).default(0) }),
  z.object({ type: z.literal("text"), text: z.string().max(131072) }),
  z.object({ type: z.literal("navigate"), url: z.string().max(8192) }),
  z.object({ type: z.literal("history"), action: z.enum(["back", "forward", "reload"]) }),
]);
export type NativeStep = { kind: string; ref?: string; selector?: string; text?: string; clear?: boolean; submit?: boolean; key?: string; url?: string; x?: number; y?: number; button?: "left" | "middle" | "right"; clickCount?: number; direction?: "up" | "down"; deltaX?: number; deltaY?: number };
type Run = { id: string; chat: string; io: AgentIO; page: Page; context: BrowserContext; cdp: CDPSession; held: boolean; generation: number; refs: Set<string>; viewers: Set<WebSocket>; queue: Promise<void>; stream: Promise<void>; streaming: boolean; downloads: FileData[]; closing: boolean; pointer: { x: number; y: number; buttons: number }; keys: Map<string, { key: string; code: string }> };

function webUrl(value: string) {
  const url = new URL(value.includes(":") ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("请输入 http 或 https 网页地址。");
  return url.href;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

export class NativeBrowserManager implements Browsers {
  private runs = new Map<string, Run>();
  private opening = new Map<string, Promise<void>>();
  private launching = 0;
  private cancelled = new Set<string>();
  private host: Host | undefined;
  private options: { executablePath: string; directory: string; maxBrowsers?: number };
  constructor(options: { executablePath: string; directory: string; maxBrowsers?: number }) { this.options = options; mkdirSync(options.directory, { recursive: true }); }
  bind(host: Host) { this.host = host; }
  owns = (id: string) => this.runs.has(id) || this.opening.has(id);
  private async run(id: string) { await this.opening.get(id); const run = this.runs.get(id); if (!run) throw new Error("此浏览器已关闭。"); return run; }
  private assertScope(run: Run, chat: string) { if (run.chat !== chat) throw new Error("该浏览器属于另一个会话。"); }
  private assertAgent(run: Run) { if (run.held) throw new Error("用户正在手机或网页端接管这个浏览器。请停止操作，等待用户点击 Done／交还控制权；不要改用其他工具绕过接管。"); }
  private beginJob(run: Run) {
    this.assertAgent(run);
    const entity = this.host?.external.state(run.chat).entities.find((item) => item.id === run.id);
    if (entity?.kind === "browser" && entity.status === "idle") {
      const result = run.io.act({ kind: "browserJob", id: run.id, title: entity.title, instructions: "在当前 Amuse 聊天的同一浏览器中执行用户任务。", files: entity.files });
      if (!result.ok) throw new Error(`无法开始浏览器任务：${JSON.stringify(result.rejection)}`);
    }
  }
  private exclusive<T>(run: Run, action: () => Promise<T>): Promise<T> {
    const result = run.queue.then(() => { this.assertAgent(run); return action(); });
    run.queue = result.then(() => {}, () => {});
    return result;
  }
  private ready(run: Run) { const size = run.page.viewportSize() ?? { width: 1024, height: 768 }; return { type: "ready", transport: "native" as const, ...size, generation: run.generation, url: run.page.url(), title: "Browser" }; }
  private notify(run: Run) { const message = JSON.stringify(this.ready(run)); for (const viewer of run.viewers) if (viewer.readyState === WebSocket.OPEN) viewer.send(message); }
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
  }
  ports(): Pick<Ports, "browse" | "browser" | "job" | "fit"> {
    return {
      browse: (browser, io) => {
        const promise = this.launch(browser, io).catch((error) => {
          io.act({ kind: "browserEnded", id: browser.id, status: "failed", result: error instanceof Error ? error.message : String(error) });
          io.act({ kind: "released", id: browser.id });
          throw error;
        });
        this.opening.set(browser.id, promise); void promise.catch(() => {});
      },
      browser: ({ browser, action }) => {
        if (action === "stop") this.cancelled.add(browser.id);
        const run = this.runs.get(browser.id); if (!run) return;
        run.held = action === "take";
        if (action === "stop") { void this.close(browser.id).catch(() => {}); return; }
        run.queue = run.queue.then(() => this.releaseInput(run));
        this.notify(run);
      },
      job: () => {},
      fit: ({ id, viewer }) => { void this.fit(id, viewer).catch(() => {}); },
    };
  }
  private async launch(browser: BrowserEntity, io: AgentIO) {
    if (this.runs.size + this.launching >= (this.options.maxBrowsers ?? 2)) throw new Error("浏览器数量已达上限，请先关闭一个。");
    this.launching++;
    const directory = join(this.options.directory, "profiles", digest(browser.id));
    let context: BrowserContext;
    try { context = await chromium.launchPersistentContext(directory, { executablePath: this.options.executablePath, headless: true, viewport: { width: 1024, height: 768 }, acceptDownloads: true, downloadsPath: join(this.options.directory, "downloads"), args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking"] }); }
    finally { this.launching--; }
    try {
      if (this.cancelled.has(browser.id)) throw new Error("浏览器已关闭。");
      const page = context.pages()[0] ?? await context.newPage();
      const cdp = await context.newCDPSession(page);
      const run: Run = { id: browser.id, chat: io.chat, io, page, context, cdp, held: browser.status === "paused", generation: 1, refs: new Set(), viewers: new Set(), queue: Promise.resolve(), stream: Promise.resolve(), streaming: false, downloads: [], closing: false, pointer: { x: 0, y: 0, buttons: 0 }, keys: new Map() };
      this.runs.set(browser.id, run);
      cdp.on("Page.screencastFrame", (event) => {
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
        const frame = Buffer.from(event.data, "base64");
        for (const viewer of run.viewers) if (viewer.readyState === WebSocket.OPEN && viewer.bufferedAmount < 512 * 1024) viewer.send(frame, { binary: true });
      });
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) { run.refs.clear(); run.generation++; void this.metadata(run).catch(() => {}); } });
      page.on("load", () => { void this.metadata(run).catch(() => {}); });
      page.on("close", () => { if (!run.closing) void this.close(run.id).catch(() => {}); });
      page.on("download", (download) => { void (async () => { const path = await download.path(); if (!path) return; const { readFile } = await import("node:fs/promises"); run.downloads.push({ name: download.suggestedFilename(), data: await readFile(path) }); })().catch(() => {}); });
      await page.goto(webUrl(browser.url), { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (this.cancelled.has(browser.id)) throw new Error("浏览器已关闭。");
      await this.metadata(run);
    } catch (error) { await context.close().catch(() => {}); this.runs.delete(browser.id); throw error; }
  }
  async open(): Promise<void> { throw new Error("Use the authenticated Amuse browser.open command."); }
  async waitReady(id: string) { await this.run(id); }
  async openForChat(chat: string, url: string) {
    if (!this.host) throw new Error("Browser host is not ready.");
    const result = await this.host.call("browser.open", { chat, url: webUrl(url) });
    await this.run(result.id);
    return result;
  }
  async openForAgent(chat: string, url: string) { const opened = await this.openForChat(chat, url); await this.host!.call("browser.control", { id: opened.id, action: "handBack" }); this.beginJob(await this.run(opened.id)); return opened; }
  list(chat: string) { return [...this.runs.values()].filter((run) => run.chat === chat).map((run) => ({ id: run.id, url: run.page.url(), controlledBy: run.held ? "user" : "agent" })); }
  async info(id: string) { const run = await this.run(id); return { transport: "native" as const, ...(run.page.viewportSize() ?? { width: 1024, height: 768 }) }; }
  async look(id: string): Promise<PageView> {
    const run = await this.run(id); this.assertAgent(run);
    const prefix = `a${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const view = await run.page.evaluate((prefix) => {
      let index = 0;
      const elements = Array.from(document.querySelectorAll<HTMLElement>('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')).filter((element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== "hidden"; }).map((element) => {
        const ref = `${prefix}-${++index}`; element.setAttribute("data-amuse-ref", ref);
        return { ref, role: element.getAttribute("role") || element.tagName.toLowerCase(), label: element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.innerText || element.getAttribute("name") || element.tagName.toLowerCase(), href: element instanceof HTMLAnchorElement ? element.href : null, disabled: element.hasAttribute("disabled") };
      });
      return { url: location.href, title: document.title, text: document.body.innerText, elements };
    }, prefix);
    run.refs = new Set(view.elements.map((element) => element.ref)); return view;
  }
  async observeForChat(chat: string, id: string) { const run = await this.run(id); this.assertScope(run, chat); return this.look(id); }
  async actForChat(chat: string, id: string, step: NativeStep) { const run = await this.run(id); this.assertScope(run, chat); return this.exclusive(run, async () => { await this.act(run, step); return this.look(id); }); }
  async step(id: string, step: Step) { const run = await this.run(id); await this.exclusive(run, () => this.act(run, step)); }
  private async act(run: Run, step: NativeStep) {
    this.assertAgent(run);
    this.beginJob(run);
    const locator = step.ref ? (() => { if (!run.refs.has(step.ref!)) throw new Error("页面引用已过期，请重新 observe。"); return run.page.locator(`[data-amuse-ref="${step.ref}"]`); })() : step.selector ? run.page.locator(step.selector) : undefined;
    if (step.kind === "navigate") await run.page.goto(webUrl(step.url ?? ""), { waitUntil: "domcontentloaded" });
    else if (step.kind === "click") {
      if (locator) { await locator.click({ trial: true, timeout: 5000 }); this.assertAgent(run); await locator.click({ button: step.button ?? "left", clickCount: step.clickCount ?? 1, force: true, timeout: 1000 }); }
      else { this.assertAgent(run); await run.page.mouse.click(step.x ?? 0, step.y ?? 0, { button: step.button ?? "left", clickCount: step.clickCount ?? 1 }); }
    } else if (step.kind === "type") { if (locator) { this.assertAgent(run); if (step.clear !== false) await locator.fill(step.text ?? "", { timeout: 1000 }); else { await locator.focus(); this.assertAgent(run); await run.page.keyboard.insertText(step.text ?? ""); } if (step.submit) { this.assertAgent(run); await locator.press("Enter"); } } else await run.page.keyboard.insertText(step.text ?? ""); }
    else if (step.kind === "press") await run.page.keyboard.press(step.key ?? "Enter");
    else if (step.kind === "scroll") await run.page.mouse.wheel(step.deltaX ?? 0, step.deltaY ?? (step.direction === "up" ? -500 : 500));
    else throw new Error("Unknown browser action.");
    await this.metadata(run);
  }
  async screenshot(id: string) { return new Uint8Array(await (await this.run(id)).page.screenshot({ type: "png" })); }
  async screenshotForChat(chat: string, id: string) { const run = await this.run(id); this.assertScope(run, chat); this.assertAgent(run); return this.screenshot(id); }
  async finishForChat(chat: string, id: string, result: string) { const run = await this.run(id); this.assertScope(run, chat); this.assertAgent(run); this.beginJob(run); const ended = run.io.act({ kind: "browserEnded", id, status: "completed", result }); if (!ended.ok) throw new Error(`无法结束浏览器任务：${JSON.stringify(ended.rejection)}`); }
  async remember() {} // Persistent isolated profiles retain the browser's own cookies on disk.
  async fit(id: string, viewer: Size | null) { const run = await this.run(id); const size = viewer ? fitted(viewer) : { width: 1024, height: 768 }; if (JSON.stringify(run.page.viewportSize()) !== JSON.stringify(size)) { await run.page.setViewportSize(size); run.generation++; this.notify(run); } }
  async close(id: string) { this.cancelled.add(id); const run = this.runs.get(id); if (!run || run.closing) return; run.closing = true; for (const viewer of run.viewers) viewer.close(1000, "browser closed"); try { await run.context.close(); } finally { this.runs.delete(id); this.opening.delete(id); run.io.act({ kind: "released", id }); } }
  vnc() { return null; }
  async upload(id: string, ref: string, file: FileData) { const run = await this.run(id); this.assertAgent(run); if (!run.refs.has(ref)) throw new Error("请重新观察页面。"); await run.page.locator(`[data-amuse-ref="${ref}"]`).setInputFiles({ name: file.name, mimeType: "application/octet-stream", buffer: Buffer.from(file.data) }); }
  async downloads(id: string) { return (await this.run(id)).downloads.splice(0); }
  async stillOpen(id: string) { return this.runs.has(id) && !this.runs.get(id)!.page.isClosed(); }
  attach = (viewer: WebSocket, id: string, controlled: () => boolean) => {
    let attached: Run | undefined;
    const sendError = (message: string) => { if (viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify({ type: "error", message })); };
    void this.run(id).then(async (run) => {
      if (viewer.readyState !== WebSocket.OPEN) return;
      attached = run; run.viewers.add(viewer); this.notify(run);
      await this.updateStream(run);
      if (viewer.readyState === WebSocket.OPEN) viewer.send(await run.page.screenshot({ type: "jpeg", quality: 75 }), { binary: true });
    }).catch((error) => sendError(error instanceof Error ? error.message : String(error)));
    viewer.on("message", (data, binary) => {
      if (binary || data.toString().length > 256 * 1024) return;
      let input: z.infer<typeof Input>;
      try { input = Input.parse(JSON.parse(data.toString())); } catch { sendError("无效的浏览器输入。"); return; }
      const run = attached; if (!run) return;
      // Check when queued AND when executed. A stale UI cannot grant itself control.
      if (!controlled() || !run.held) { sendError("请先点击接管，再操作浏览器。"); return; }
      run.queue = run.queue.then(async () => {
        if (!controlled() || !run.held) return;
        if ("generation" in input && input.generation !== run.generation) return;
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
    viewer.on("close", () => { if (!attached) return; const run = attached; run.viewers.delete(viewer); void this.updateStream(run).catch(() => {}); if (run.viewers.size === 0) run.queue = run.queue.then(() => this.releaseInput(run)); });
  };
  async shutdown() { await Promise.allSettled([...this.runs.keys()].map((id) => this.close(id))); }
}
