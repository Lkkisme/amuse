/**
 * Real browsers for browser runs: one headless Chromium, one isolated
 * context (cookies, storage) and page per run, keyed by the run's id.
 * Chromium starts on first use and is shared after that.
 */
import { type Browser as Chromium, type Page, chromium } from "playwright-core";

export interface Pool {
  /** Open the run's page at `url` (or return it if it is already open). */
  open(id: string, url: string): Promise<Page>;
  page(id: string): Page | undefined;
  close(id: string): Promise<void>;
  shutdown(): Promise<void>;
}

export const viewport = { width: 1280, height: 800 };

export function pool(): Pool {
  let browser: Promise<Chromium> | undefined;
  const pages = new Map<string, Page>();
  const launch = () => {
    browser ??= chromium.launch({ headless: true }).catch((error: unknown) => {
      browser = undefined; // try again next time
      throw error;
    });
    return browser;
  };

  return {
    async open(id, url) {
      const existing = pages.get(id);
      if (existing) return existing;
      const context = await (await launch()).newContext({ viewport });
      const page = await context.newPage();
      pages.set(id, page);
      page.on("close", () => pages.delete(id));
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return page;
    },
    page: (id) => pages.get(id),
    async close(id) {
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
