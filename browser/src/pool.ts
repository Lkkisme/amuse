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
import { type BrowserContext, type Browser as Chromium, type Page, chromium } from "playwright-core";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * Apply what one context changed — `before` is its state when it opened (or
 * last saved), `after` is now — to the stored state: changed and new cookies
 * and origins replace theirs, removed ones are removed. What the context did
 * not touch stays as stored, so another run's fresh login survives a stale
 * context's save, and a logout sticks.
 */
export function applyChanges(stored: StorageState, before: StorageState, after: StorageState): StorageState {
  const cookieKey = (c: StorageState["cookies"][number]) => `${c.name}\0${c.domain}\0${c.path}`;
  const originKey = (o: StorageState["origins"][number]) => o.origin;
  function merge<T>(stored: T[], before: T[], after: T[], key: (t: T) => string): T[] {
    const was = new Map(before.map((t) => [key(t), JSON.stringify(t)]));
    const now = new Map(after.map((t) => [key(t), t]));
    const result = new Map(stored.map((t) => [key(t), t]));
    for (const k of was.keys()) if (!now.has(k)) result.delete(k);
    for (const [k, t] of now) if (was.get(k) !== JSON.stringify(t)) result.set(k, t);
    return [...result.values()];
  }
  return {
    cookies: merge(stored.cookies, before.cookies, after.cookies, cookieKey),
    origins: merge(stored.origins, before.origins, after.origins, originKey),
  };
}

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
  /** Each page's state as of opening or its last save: what its next save compares against. */
  const baseline = new Map<string, StorageState>();
  /** Opens in flight, so two opens of one run share one context. */
  const opening = new Map<string, Promise<Page>>();
  const launch = () => {
    browser ??= chromium.launch({ headless: true }).catch((error: unknown) => {
      browser = undefined; // try again next time
      throw error;
    });
    return browser;
  };

  /** The saved state as Playwright reads it (it parses the file for us), or nothing yet. */
  const stored = async (file: string): Promise<StorageState> => {
    const empty: StorageState = { cookies: [], origins: [] };
    if (!existsSync(file)) return empty;
    const context = await (await launch()).newContext({ storageState: file }).catch(() => null);
    if (!context) return empty;
    const state = await context.storageState();
    await context.close();
    return state;
  };

  /** One save at a time: merge into what is stored, write a private temp file, rename it into place. */
  let saving: Promise<void> = Promise.resolve();
  const save = (id: string) => {
    const run = async () => {
      const page = pages.get(id);
      const before = baseline.get(id);
      if (!stateFile || !page || !before) return;
      const after = await page.context().storageState();
      const merged = applyChanges(await stored(stateFile), before, after);
      baseline.set(id, after);
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      const temp = `${stateFile}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(merged), { mode: 0o600 });
      await rename(temp, stateFile);
    };
    const done = saving.then(run);
    saving = done.catch(() => {});
    return done;
  };

  const create = async (id: string, url: string): Promise<Page> => {
    const saved = stateFile && existsSync(stateFile) ? { storageState: stateFile } : {};
    const context = await (await launch()).newContext({ viewport, ...saved });
    try {
      const page = await context.newPage();
      baseline.set(id, await context.storageState());
      // registered before it loads, so it can be watched (live view, thumbnail) while it does
      pages.set(id, page);
      page.on("close", () => {
        pages.delete(id);
        baseline.delete(id);
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return page;
    } catch (error) {
      pages.delete(id);
      baseline.delete(id);
      await context.close().catch(() => {}); // a page that never opened leaves nothing behind
      throw error;
    }
  };

  return {
    open(id, url) {
      const existing = pages.get(id);
      if (existing) return Promise.resolve(existing);
      const pending = opening.get(id) ?? create(id, url).finally(() => opening.delete(id));
      opening.set(id, pending);
      return pending;
    },
    page: (id) => pages.get(id),
    save,
    async close(id) {
      await opening.get(id)?.catch(() => {}); // an open in flight finishes first, so its context is closed too
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
