/**
 * The user's rules (core/policy.ts) — per app, for the browser by kind of action, and per site — in the
 * database: read once on start, and written whole in one transaction on each change, so a crash leaves the old
 * rules or the new ones, never half of either. The older rules.json, in the shapes it has had, is read by the
 * import (db/src/legacy/rules.ts), once.
 */
import { type AllRules, type Rules, setBrowserAction, setRule, setSiteAction, setSiteEntry } from "@amuse/core";
import { type Db, query, transaction } from "@amuse/db";
import { BrowserAction, Permission, type SiteActions, type SiteEntry, ToolKind } from "@amuse/protocol";
import { z } from "zod";

const Row = {
  app: z.object({ app: z.string(), kind: ToolKind, permission: Permission }),
  browser: z.object({ action: BrowserAction, permission: Permission }),
  site: z.object({ site: z.string(), never: z.number(), visit: Permission.nullable(), submit: Permission.nullable(), download: Permission.nullable(), upload: Permission.nullable() }),
};

function read(db: Db): AllRules {
  const apps: AllRules["apps"] = {};
  for (const { app, kind, permission } of query(db, Row.app, "select app, kind, permission from app_rules")) apps[app] = { ...apps[app], [kind]: permission };
  const browser: SiteActions = {};
  for (const { action, permission } of query(db, Row.browser, "select action, permission from browser_rules")) browser[action] = permission;
  const sites: Record<string, SiteEntry> = {};
  for (const { site, never, visit, submit, download, upload } of query(db, Row.site, "select site, never, visit, submit, download, upload from site_rules")) {
    const actions: SiteActions = {};
    if (visit) actions.visit = visit;
    if (submit) actions.submit = submit;
    if (download) actions.download = download;
    if (upload) actions.upload = upload;
    sites[site] = { never: never === 1, actions };
  }
  return { apps, browser, sites };
}

function write(db: Db, all: AllRules): void {
  transaction(db, () => {
    db.exec("delete from app_rules; delete from browser_rules; delete from site_rules");
    for (const [app, kinds] of Object.entries(all.apps))
      for (const [kind, permission] of Object.entries(kinds)) if (permission !== undefined) db.prepare("insert into app_rules (app, kind, permission) values (?, ?, ?)").run(app, kind, permission);
    for (const [action, permission] of Object.entries(all.browser)) if (permission !== undefined) db.prepare("insert into browser_rules (action, permission) values (?, ?)").run(action, permission);
    for (const [site, { never, actions }] of Object.entries(all.sites))
      db.prepare("insert into site_rules (site, never, visit, submit, download, upload) values (?, ?, ?, ?, ?, ?)").run(
        site,
        never ? 1 : 0,
        actions.visit ?? null,
        actions.submit ?? null,
        actions.download ?? null,
        actions.upload ?? null,
      );
  });
}

export function sqliteRules(db: Db): Rules {
  let all = read(db);
  const save = (next: AllRules) => {
    write(db, next);
    all = next;
  };
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
