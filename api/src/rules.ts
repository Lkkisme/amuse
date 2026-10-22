/**
 * The user's rules (core/policy.ts) — per app, for the browser by kind of
 * action, and per site — as a JSON file (mode 600): read on start, written
 * whole on each change through a temporary file, so a crash leaves the old
 * rules or the new ones, never half of either. A file that does not parse
 * stops the start rather than being taken for no rules.
 *
 * Site rules used to be one choice per site (allow, ask, deny). They are read
 * as the exceptions they became, and the file is written again in the new shape:
 *   allow  every action allowed there (uploads stay as they were: asked)
 *   ask    visiting allowed there (the rest follows the browser's rules; under a site
 *          that was allowed, submit and download are set as the defaults give them, so
 *          the allow above does not reach down)
 *   deny   never visited
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type AllRules, type Rules, defaultBrowser, noRules, setBrowserAction, setRule, setSiteAction, setSiteEntry } from "@amuse/core";
import { BrowserAction, Permission, Site, type SiteActions, type SiteEntry, ToolKind } from "@amuse/protocol";
import { z } from "zod";

/** The four actions as stored: read leniently, so one bad entry never stops the server (it is dropped, and said). */
const Actions = z.object({ visit: Permission.optional(), submit: Permission.optional(), download: Permission.optional(), upload: Permission.optional() });
const Entry = z.object({ never: z.boolean(), actions: Actions });

/** A site and its parents, nearest first. */
const lineage = (site: string): string[] => {
  const labels = site.split(".");
  return labels.map((_, i) => labels.slice(i).join("."));
};

/**
 * What the one old choice per site becomes. An "ask" under a site that was "allow" sets submit and download as the browser's defaults give
 * them, so that the allow above it does not reach down: nothing becomes wider than it was.
 */
function migrated(old: Readonly<Record<string, Permission>>): Record<string, SiteEntry> {
  const entries: Record<string, SiteEntry> = {};
  for (const [site, permission] of Object.entries(old)) {
    if (permission === "allow") entries[site] = { never: false, actions: { visit: "allow", submit: "allow", download: "allow" } };
    else if (permission === "deny") entries[site] = { never: true, actions: {} };
    else {
      const underAllow = lineage(site)
        .slice(1)
        .some((parent) => old[parent] === "allow");
      entries[site] = {
        never: false,
        actions: underAllow ? { visit: "allow", submit: defaultBrowser.submit, download: defaultBrowser.download } : { visit: "allow" },
      };
    }
  }
  return entries;
}

/** An upload is never allowed: a stored "allow" is "ask". */
const settled = (actions: SiteActions, log: (message: string) => void, where: string): SiteActions => {
  if (actions.upload !== "allow") return actions;
  log(`rules: uploading is always asked about; the "allow" kept for ${where} is read as "ask".`);
  return { ...actions, upload: "ask" };
};

const File = z.object({
  apps: z.record(z.string(), z.partialRecord(ToolKind, Permission)),
  browser: z.record(z.string(), z.unknown()).default({}),
  sites: z.record(z.string(), z.unknown()),
});

/** A site's name as a rule keeps it: lower-case, without trailing dots or "www.", as the browser's sites are named (core/policy.ts). */
const named = (site: string) => site.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");

const strictness: Record<Permission, number> = { allow: 0, ask: 1, deny: 2 };
const stricter = (a: Permission | undefined, b: Permission | undefined) => (a === undefined ? b : b === undefined ? a : strictness[a] >= strictness[b] ? a : b);

/** Two entries kept under one name (an old spelling and its plain one): the stricter of each. */
const joined = (a: SiteEntry | undefined, b: SiteEntry): SiteEntry => {
  if (!a) return b;
  const actions: SiteActions = {};
  for (const action of ["visit", "submit", "download", "upload"] satisfies (keyof SiteActions)[]) {
    const permission = stricter(a.actions[action], b.actions[action]);
    if (permission !== undefined) actions[action] = permission;
  }
  return { never: a.never || b.never, actions };
};

/** The old shape's entries and the new's, together: where a site is in both (a file edited by hand), the stricter of each. */
const both = (old: Record<string, SiteEntry>, current: Record<string, SiteEntry>): Record<string, SiteEntry> => {
  const all = { ...old };
  for (const [site, entry] of Object.entries(current)) all[site] = joined(all[site], entry);
  return all;
};

/**
 * The rules as stored, and whether the file needs writing again (it held the old shape, or something that was read otherwise). Nothing
 * that could not be read ever makes the rules wider, nor stops the server: a site's name is read as its plain spelling; a site's entry
 * that cannot be read is read as never visiting it; a setting for the browser that cannot be read is read as asking. Only a name no rule
 * can be kept under is dropped. Each is said in the log, and the file as it was is kept beside it before it is written again.
 */
function read(raw: unknown, log: (message: string) => void): { rules: AllRules; changed: boolean } {
  const file = File.parse(raw);
  let changed = typeof raw === "object" && raw !== null && !("browser" in raw);
  const old: Record<string, Permission> = {};
  const current: Record<string, SiteEntry> = {};
  for (const [written, value] of Object.entries(file.sites)) {
    const site = named(written);
    if (site !== written) {
      log(`rules: the rule for "${written}" is kept as ${site}.`);
      changed = true;
    }
    if (!Site.safeParse(site).success) {
      log(`rules: the rule for "${written}" is dropped: it is not a website name a rule can be kept for.`);
      changed = true;
      continue;
    }
    const was = Permission.safeParse(value);
    const entry = Entry.safeParse(value);
    if (was.success) {
      old[site] = stricter(old[site], was.data) ?? was.data;
      changed = true;
    } else if (entry.success) {
      current[site] = joined(current[site], { never: entry.data.never, actions: settled(entry.data.actions, log, site) });
      changed ||= entry.data.actions.upload === "allow";
    } else {
      log(`rules: the rule for ${site} could not be read: it is read as never visiting ${site}, until it is set again.`);
      current[site] = joined(current[site], { never: true, actions: {} });
      changed = true;
    }
  }
  const asStored: SiteActions = {};
  for (const [action, value] of Object.entries(file.browser)) {
    const known = BrowserAction.safeParse(action);
    if (!known.success) continue;
    const permission = Permission.safeParse(value);
    if (permission.success) asStored[known.data] = permission.data;
    else {
      log(`rules: the browser's setting for ${action} could not be read: it is read as "ask".`);
      asStored[known.data] = "ask";
      changed = true;
    }
  }
  const browser = settled(asStored, log, "the browser");
  changed ||= asStored.upload === "allow";
  return { rules: { apps: file.apps, browser, sites: both(migrated(old), current) }, changed };
}

export function fileRules(path: string, log: (message: string) => void = console.warn): Rules {
  const raw: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const stored = raw === null ? { rules: noRules, changed: false } : read(raw, log);
  let all: AllRules = stored.rules;
  const save = (next: AllRules) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.next`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
    all = next;
  };
  if (stored.changed) {
    // what was there stays beside it, to put back what reading it otherwise lost
    copyFileSync(path, `${path}.${Date.now()}.bak`);
    save(all);
  }
  return {
    of: async (app) => ({ ...all.apps[app] }),
    set: async (app, kind, permission) => save({ ...all, apps: setRule(all.apps, app, kind, permission) }),
    browser: async () => ({ ...all.browser }),
    setBrowser: async (action, permission) => save({ ...all, browser: setBrowserAction(all.browser, action, permission) }),
    sites: async () => ({ ...all.sites }),
    setSite: async (site, entry) => save({ ...all, sites: setSiteEntry(all.sites, site, entry) }),
    setSiteAction: async (site, action, permission) => save({ ...all, sites: setSiteAction(all.sites, site, action, permission) }),
  };
}
