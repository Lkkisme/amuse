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
 *   ask    visiting allowed there (the rest follows the browser's rules)
 *   deny   never visited
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type AllRules, type Rules, noRules, setBrowserAction, setRule, setSiteAction, setSiteEntry } from "@amuse/core";
import { Permission, Site, SiteActions, SiteEntry, ToolKind } from "@amuse/protocol";
import { z } from "zod";

/** What a site's one old choice becomes. */
const migrated = (permission: Permission): SiteEntry =>
  permission === "allow" ? { never: false, actions: { visit: "allow", submit: "allow", download: "allow" } } : permission === "ask" ? { never: false, actions: { visit: "allow" } } : { never: true, actions: {} };

const File = z.object({
  apps: z.record(z.string(), z.partialRecord(ToolKind, Permission)),
  browser: SiteActions.default({}),
  sites: z.record(Site, z.union([SiteEntry, Permission.transform(migrated)])),
});

/** Whether a file is in the shape before the browser's rules: a site's one choice, and no browser rules. */
const old = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null) return false;
  const sites = "sites" in raw ? raw.sites : null;
  return !("browser" in raw) || (typeof sites === "object" && sites !== null && Object.values(sites).some((v) => typeof v === "string"));
};

export function fileRules(path: string): Rules {
  const raw: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  let all: AllRules = raw === null ? noRules : File.parse(raw);
  const save = (next: AllRules) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.next`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
    all = next;
  };
  if (old(raw)) save(all);
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
