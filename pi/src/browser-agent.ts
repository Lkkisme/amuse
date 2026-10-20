/**
 * The browser agent: one Pi session per browser run, driving that run's
 * page through a few tools (observe, click, type, press, navigate, scroll),
 * asking the user when it is stuck (need_user: the run waits for the user
 * to take over and hand back), and finishing with a result that is reported
 * to the main agent. While the user holds the browser, every tool waits.
 */
import { type AgentSession, type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import type { Pool } from "@remuse/browser";
import type { Ports, RunIO } from "@remuse/core";
import type { Browser } from "@remuse/protocol";
import type { Page } from "playwright-core";
import { Type } from "typebox";
import { redact } from "./redact.ts";
import { type PiModelConfig, openSession } from "./session.ts";

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
  io: RunIO;
  session: AgentSession | null;
  /** Set while the user holds the browser; resolves when it is handed back (true) or stopped (false). */
  held: { promise: Promise<boolean>; settle: (resumed: boolean) => void } | null;
  steps: number;
  outcome: "finished" | "stopped" | null;
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });

function hold(): NonNullable<Run["held"]> {
  let settle: (resumed: boolean) => void = () => {};
  const promise = new Promise<boolean>((resolve) => (settle = resolve));
  return { promise, settle };
}

async function observe(page: Page): Promise<string> {
  const snapshot = await page.ariaSnapshot({ mode: "ai", timeout: 10_000 }).catch(() => "(the page could not be read)");
  const cut = snapshot.length > snapshotLimit ? `${snapshot.slice(0, snapshotLimit)}\n… (truncated)` : snapshot;
  return `URL: ${page.url()}\nTitle: ${await page.title().catch(() => "")}\n${cut}`;
}

function runTools(run: Run): ToolDefinition[] {
  const set = (status: Browser["status"]) => {
    run.browser = { ...run.browser, status };
    run.io.emit({ kind: "upserted", entity: run.browser });
  };
  /** Wait out a takeover, count the step, then act and return the new page state. */
  const act = async (what: () => Promise<unknown>) => {
    if (run.held && !(await run.held.promise)) return text("The task was stopped.");
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
      description: "Click the element with this ref.",
      parameters: Type.Object({ ref: Type.String() }),
      execute: async (_, { ref: r }) => act(() => ref(r).click({ timeout: 8_000 })),
    }),
    defineTool({
      name: "type",
      label: "Type",
      description: "Replace the text in a field; set submit to press Enter afterwards.",
      parameters: Type.Object({ ref: Type.String(), text: Type.String(), submit: Type.Optional(Type.Boolean()) }),
      execute: async (_, { ref: r, text: value, submit }) =>
        act(async () => {
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
        run.io.report(`[browser task "${run.browser.title}" needs the user] ${reason}`);
        const resumed = await run.held.promise;
        return text(resumed ? `The user handed the browser back.\n\n${await observe(run.page)}` : "The task was stopped.");
      },
    }),
    defineTool({
      name: "finish",
      label: "Finish",
      description: "End the task with its result (or why it could not be done).",
      parameters: Type.Object({ result: Type.String(), done: Type.Boolean({ description: "false if the task could not be done" }) }),
      async execute(_, { result, done }) {
        run.outcome = "finished";
        set(done ? "completed" : "failed");
        run.io.report(`[browser task "${run.browser.title}" ${done ? "finished" : "failed"}] ${result}`);
        void run.session?.abort();
        return text("Finished.");
      },
    }),
  ];
}

/** browse + browser control on real pages, with a Pi agent per run. */
export function piBrowserAgent(cfg: PiModelConfig, pool: Pool): Pick<Ports, "browse" | "browser"> {
  const runs = new Map<string, Run>();

  const drive = async (run: Run) => {
    const session = await openSession(cfg, system, runTools(run));
    run.session = session;
    await session.prompt(`Task: ${run.browser.title}\nThe start page ${run.browser.url} is open.`, { expandPromptTemplates: false });
    if (!run.outcome) await session.prompt("Call finish now with the result, or need_user if you are blocked.", { expandPromptTemplates: false });
    if (!run.outcome) {
      run.outcome = "finished";
      run.io.emit({ kind: "upserted", entity: { ...run.browser, status: "failed" } });
      run.io.report(`[browser task "${run.browser.title}" failed] It stopped without a result.`);
    }
  };

  return {
    browse(browser, io) {
      pool.open(browser.id, browser.url).then(
        (page) => {
          const run: Run = { browser, page, io, session: null, held: null, steps: 0, outcome: null };
          runs.set(browser.id, run);
          drive(run)
            .catch((error: unknown) => {
              if (run.outcome) return;
              run.outcome = "finished";
              io.emit({ kind: "upserted", entity: { ...run.browser, status: "failed" } });
              io.report(`[browser task "${browser.title}" failed] ${redact(error instanceof Error ? error.message : String(error), [cfg.authPath, cfg.modelsPath])}`);
            })
            .finally(() => runs.delete(browser.id));
        },
        () => {
          io.emit({ kind: "upserted", entity: { ...browser, status: "failed" } });
          io.report(`[browser task "${browser.title}" failed] ${browser.url} did not load.`);
        },
      );
    },
    browser({ browser, action }, emit) {
      const run = runs.get(browser.id);
      if (run) run.browser = browser; // the core already recorded the move
      switch (action) {
        case "take":
          if (run) run.held ??= hold();
          return;
        case "handBack":
          if (!run) return emit({ kind: "upserted", entity: { ...browser, status: "completed" } }); // nothing left to resume
          run.held?.settle(true);
          run.held = null;
          return;
        case "stop":
          if (run) {
            run.outcome = "stopped";
            run.held?.settle(false);
            void run.session?.abort();
          }
          void pool.close(browser.id);
          return;
      }
    },
  };
}
