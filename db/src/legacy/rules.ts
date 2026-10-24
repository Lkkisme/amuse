/**
 * The rules file as older versions wrote it (rules.json), read for the import and for nothing else. Site rules used to
 * be one choice per site (allow, ask, deny); they are read as the exceptions they became:
 *   allow  every action allowed there (uploads stay as they were: asked)
 *   ask    visiting allowed there (the rest follows the browser's rules; under a site that was allowed, submit and
 *          download are set as the defaults give them, so the allow above does not reach down)
 *   deny   never visited
 * Nothing that cannot be read ever makes the rules wider, and none stops the import: see readRules.
 */
import { z } from "zod";
import { type AllRules, BrowserAction, Permission, Site, type SiteActions, type SiteEntry, ToolKind, defaultBrowser } from "./frozen.ts";

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
export function readRules(raw: unknown, log: (message: string) => void): { rules: AllRules; changed: boolean } {
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
