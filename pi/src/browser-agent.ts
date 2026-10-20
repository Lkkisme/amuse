/**
 * The browser agent: one Pi session per browser run, driving that run's
 * page through a few tools (observe, click, type, press, navigate, scroll),
 * asking the user when it is stuck (need_user: the run waits for the user
 * to take over and hand back), and finishing with a result that is reported
 * to the main agent. While the user holds the browser, every tool waits.
 */
import { type AgentSession, type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import type { Pool } from "@remuse/browser";
import type { AgentIO, BrowserProgress, Ports } from "@remuse/core";
import type { Browser } from "@remuse/protocol";
import type { Page } from "playwright-core";
import { Type } from "typebox";
import { redact } from "./redact.ts";
import { type PiModelConfig, openSession } from "./session.ts";
import { untrusted } from "./untrusted.ts";

const system = `You operate a real web browser to do one task for the user.
Work from what \`observe\` shows and act on elements by their ref; every action returns the new page state.
Use as few steps as you can.
If something only the user can do is needed (logging in, a captcha, a choice only they can make, confirming a payment), call need_user with a short reason; it returns once they hand the browser back.
Never buy anything, send messages, or submit forms that commit the user to something unless the task explicitly asks for it.
When the task is done, or cannot be done, call finish with a short result in the user's language.`;

const maxSteps = 40;
const snapshotLimit = 15_000;

/** Per-run state the tools close over. */
interface Run {
  browser: Browser;
  page: Page;
  io: AgentIO;
  session: AgentSession | null;
  /** Aborted on stop: every wait in the run ends at once. */
  stop: AbortController;
  /** Set while the user holds the browser; resolves when it is handed back. */
  held: { promise: Promise<void>; settle: () => void } | null;
  steps: number;
  finished: boolean;
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });
const stoppedText = () => text("The task was stopped.");

function hold(): NonNullable<Run["held"]> {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => (settle = resolve));
  return { promise, settle };
}

/** `promise`, or "stopped" as soon as the run is stopped. */
function untilStopped<T>(run: Run, promise: Promise<T>): Promise<T | "stopped"> {
  if (run.stop.signal.aborted) return Promise.resolve("stopped");
  return Promise.race([promise, new Promise<"stopped">((resolve) => run.stop.signal.addEventListener("abort", () => resolve("stopped"), { once: true }))]);
}

async function observe(page: Page): Promise<string> {
  const snapshot = await page.ariaSnapshot({ mode: "ai", timeout: 10_000 }).catch(() => "(the page could not be read)");
  const cut = snapshot.length > snapshotLimit ? `${snapshot.slice(0, snapshotLimit)}\n… (truncated)` : snapshot;
  return `URL: ${page.url()}\nTitle: ${await page.title().catch(() => "")}\n${cut}`;
}

function runTools(run: Run): ToolDefinition[] {
  /** Report progress through the rules; a run the user holds or stopped is not moved. */
  const set = (status: BrowserProgress) => {
    if (!run.stop.signal.aborted) run.io.act({ kind: "browserStatus", id: run.browser.id, status });
  };
  /** Wait out a takeover, count the step, then act and return the new page state. */
  const act = async (what: () => Promise<unknown>) => {
    if (run.held && (await untilStopped(run, run.held.promise)) === "stopped") return stoppedText();
    if (run.stop.signal.aborted) return stoppedText();
    if (++run.steps > maxSteps) return text(`Step limit reached; call finish now.`);
    try {
      await what();
      await run.page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    } catch (error) {
      return text(`That did not work: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n\n${await observe(run.page)}`);
    }
    return text(await observe(run.page));
  };
  const ref = (r: string) => run.page.locator(`aria-ref=${r}`);
  /** Ask the user before a consequential step; true when approved (false if stopped meanwhile). */
  const approve = async (action: string, detail: string) => {
    const asked = run.io.act({ kind: "ask", action, target: new URL(run.page.url()).host, detail });
    if (!asked.ok) return false;
    set("waiting");
    const decided = await untilStopped(run, run.io.decision(asked.id));
    if (decided === "stopped") return false;
    set("working");
    return decided === "approved";
  };
  const consequential = Type.Optional(
    Type.Boolean({ description: "true when this step buys, sends, deletes, publishes, books or submits something that commits the user" }),
  );
  const refused = () =>
    run.stop.signal.aborted ? stoppedText() : text("The user did not approve this step. Do not do it; finish or ask what they want instead.");

  return [
    defineTool({
      name: "observe",
      label: "Look at the page",
      description: "The current page as an accessibility tree; elements carry refs like [ref=e12] for the other tools.",
      parameters: Type.Object({}),
      execute: async () => act(async () => {}),
    }),
    defineTool({
      name: "click",
      label: "Click",
      description: "Click the element with this ref. Mark consequential clicks; they wait for the user's approval.",
      parameters: Type.Object({ ref: Type.String(), consequential, what: Type.Optional(Type.String({ description: "for consequential clicks: what it will do, for the user" })) }),
      execute: async (_, { ref: r, consequential: risky, what }) =>
        risky && !(await approve("Click", what ?? `Click ${r}`)) ? refused() : act(() => ref(r).click({ timeout: 8_000 })),
    }),
    defineTool({
      name: "type",
      label: "Type",
      description: "Replace the text in a field; set submit to press Enter afterwards. Mark consequential submits.",
      parameters: Type.Object({ ref: Type.String(), text: Type.String(), submit: Type.Optional(Type.Boolean()), consequential }),
      execute: async (_, { ref: r, text: value, submit, consequential: risky }) =>
        risky && submit && !(await approve("Submit", `Enter "${value}" and submit`))
          ? refused()
          : act(async () => {
              await ref(r).fill(value, { timeout: 8_000 });
              if (submit) await ref(r).press("Enter");
            }),
    }),
    defineTool({
      name: "press",
      label: "Press a key",
      description: "Press a key on the focused element, e.g. Enter, Escape, ArrowDown.",
      parameters: Type.Object({ key: Type.String() }),
      execute: async (_, { key }) => act(() => run.page.keyboard.press(key)),
    }),
    defineTool({
      name: "navigate",
      label: "Go to a URL",
      description: "Open an absolute http(s) URL in this browser.",
      parameters: Type.Object({ url: Type.String() }),
      execute: async (_, { url }) =>
        URL.canParse(url) && /^https?:$/.test(new URL(url).protocol)
          ? act(() => run.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }))
          : text(`"${url}" is not an http(s) URL.`),
    }),
    defineTool({
      name: "scroll",
      label: "Scroll",
      description: "Scroll the page by about one screen.",
      parameters: Type.Object({ direction: Type.Union([Type.Literal("down"), Type.Literal("up")]) }),
      execute: async (_, { direction }) => act(() => run.page.mouse.wheel(0, direction === "down" ? 700 : -700)),
    }),
    defineTool({
      name: "need_user",
      label: "Ask the user",
      description: "Stop and ask the user to do something in this browser. Returns when they hand it back.",
      parameters: Type.Object({ reason: Type.String() }),
      async execute(_, { reason }) {
        run.held ??= hold();
        set("needs_you");
        run.io.report(`[browser task "${run.browser.title}" needs the user]\n${untrusted(reason)}`);
        if ((await untilStopped(run, run.held.promise)) === "stopped") return stoppedText();
        return text(`The user handed the browser back.\n\n${await observe(run.page)}`);
      },
    }),
    defineTool({
      name: "finish",
      label: "Finish",
      description: "End the task with its result (or why it could not be done).",
      parameters: Type.Object({ result: Type.String(), done: Type.Boolean({ description: "false if the task could not be done" }) }),
      async execute(_, { result, done }) {
        if (run.stop.signal.aborted) return stoppedText();
        run.finished = true;
        set(done ? "completed" : "failed");
        run.io.report(`[browser task "${run.browser.title}" ${done ? "finished" : "failed"}]\n${untrusted(result)}`);
        void run.session?.abort();
        return text("Finished.");
      },
    }),
  ];
}

/** A finished run's page stays open this long for the user to look at, then closes. */
const keepFinishedMs = 30 * 60_000;

/** browse + browser control on real pages, with a Pi agent per run. */
export function piBrowserAgent(cfg: PiModelConfig, pool: Pool): Pick<Ports, "browse" | "browser"> {
  /** Every run from browse until it ends; its controller is there before its page is. */
  const stops = new Map<string, AbortController>();
  const runs = new Map<string, Run>();

  const fail = (browser: Browser, io: AgentIO, why: string) => {
    if (io.act({ kind: "browserStatus", id: browser.id, status: "failed" }).ok) io.report(`[browser task "${browser.title}" failed]\n${untrusted(why)}`);
  };

  const drive = async (run: Run) => {
    const session = await openSession(cfg, system, runTools(run));
    run.session = session;
    if (run.stop.signal.aborted) return;
    await session.prompt(`Task: ${run.browser.title}\nThe start page ${run.browser.url} is open.`, { expandPromptTemplates: false });
    if (!run.finished && !run.stop.signal.aborted)
      await session.prompt("Call finish now with the result, or need_user if you are blocked.", { expandPromptTemplates: false });
    if (!run.finished && !run.stop.signal.aborted) fail(run.browser, run.io, "It stopped without a result.");
  };

  return {
    browse(browser, io) {
      const stop = new AbortController();
      stops.set(browser.id, stop);
      const end = () => {
        stops.delete(browser.id);
        runs.delete(browser.id);
        setTimeout(() => void pool.close(browser.id), keepFinishedMs).unref?.();
      };
      pool
        .open(browser.id, browser.url)
        .then(async (page) => {
          if (stop.signal.aborted) return void pool.close(browser.id); // stopped while the page was opening
          const run: Run = { browser, page, io, session: null, stop, held: null, steps: 0, finished: false };
          runs.set(browser.id, run);
          await drive(run);
          await pool.save(browser.id).catch(() => {});
        })
        .catch((error: unknown) => {
          if (!stop.signal.aborted) fail(browser, io, redact(error instanceof Error ? error.message : String(error), [cfg.authPath, cfg.modelsPath]));
        })
        .finally(end);
    },
    browser({ browser, action }, io) {
      const run = runs.get(browser.id);
      switch (action) {
        case "take":
          if (run) run.held ??= hold();
          return;
        case "handBack":
          void pool.save(browser.id).catch(() => {}); // the user may have just logged in
          if (!run) return void io.act({ kind: "browserStatus", id: browser.id, status: "completed" }); // nothing left to resume
          run.held?.settle();
          run.held = null;
          return;
        case "stop":
          stops.get(browser.id)?.abort();
          void run?.session?.abort();
          void pool.close(browser.id);
          return;
      }
    },
  };
}
