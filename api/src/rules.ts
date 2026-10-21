/**
 * The user's rules (core/policy.ts) — per app and per site — as a JSON file
 * (mode 600): read on start, written whole on each change through a
 * temporary file, so a crash leaves the old rules or the new ones, never
 * half of either. A file that does not parse stops the start rather than
 * being taken for no rules.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  type AllRules,
  type Rules,
  noRules,
  setRule,
  setSiteRule,
} from "@remuse/core";
import { Permission, Site, ToolKind } from "@remuse/protocol";
import { z } from "zod";

const File = z.object({
  apps: z.record(z.string(), z.partialRecord(ToolKind, Permission)),
  sites: z.record(Site, Permission),
});

export function fileRules(path: string): Rules {
  let all: AllRules = existsSync(path)
    ? File.parse(JSON.parse(readFileSync(path, "utf8")))
    : noRules;
  const save = (next: AllRules) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.next`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
    all = next;
  };
  return {
    of: async (app) => ({ ...all.apps[app] }),
    set: async (app, kind, permission) =>
      save({ ...all, apps: setRule(all.apps, app, kind, permission) }),
    sites: async () => ({ ...all.sites }),
    setSite: async (site, permission) =>
      save({ ...all, sites: setSiteRule(all.sites, site, permission) }),
  };
}
