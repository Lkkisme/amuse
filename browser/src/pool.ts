/**
 * Real browsers for browser runs: one headless Chromium, one context and
 * page per run, keyed by the run's id. Chromium starts on first use and is
 * shared after that. With a state file, logins carry over between runs:
 * each run starts from the saved cookies and storage, and `save` writes them
 * back (mode 600 — they are credentials).
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { type Browser as Chromium, type Page, chromium } from "playwright-core";

export interface Pool {
  /** Open the run's page at `url` (or return it if it is already open). */
  open(id: string, url: string): Promise<Page>;
  page(id: string): Page | undefined;
  close(id: string): Promise<void>;
  /** Keep the run's cookies and storage for later runs (no-op without a state file). */
  save(id: string): Promise<void>;
  shutdown(): Promise<void>;
}

export const viewport = { width: 1280, height: 800 };

export function pool(options: { stateFile?: string } = {}): Pool {
  const { stateFile } = options;
  let browser: Promise<Chromium> | undefined;
  const pages = new Map<string, Page>();
  const launch = () => {
    browser ??= chromium.launch({ headless: true }).catch((error: unknown) => {
      browser = undefined; // try again next time
      throw error;
    });
    return browser;
  };

  /** Written to a 600 temp file and renamed into place, so the cookies are never readable by others. */
  const save = async (id: string) => {
    const page = pages.get(id);
    if (!stateFile || !page) return;
    const state = await page.context().storageState();
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    const temp = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, stateFile);
  };

  return {
    async open(id, url) {
      const existing = pages.get(id);
      if (existing) return existing;
      const saved = stateFile && existsSync(stateFile) ? { storageState: stateFile } : {};
      const context = await (await launch()).newContext({ viewport, ...saved });
      const page = await context.newPage();
      pages.set(id, page);
      page.on("close", () => pages.delete(id));
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return page;
    },
    page: (id) => pages.get(id),
    save,
    async close(id) {
      await save(id).catch(() => {});
      const page = pages.get(id);
      pages.delete(id);
      await page?.context().close();
    },
    async shutdown() {
      pages.clear();
      const running = browser;
      browser = undefined;
      await (await running)?.close();
    },
  };
}
