/**
 * The user's rules for apps (core/policy.ts) as a JSON file (mode 600):
 * read on start, written whole on each change through a temporary file, so
 * a crash leaves the old rules or the new ones, never half of either. A file
 * that does not parse stops the start rather than being taken for no rules.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type AppRules, type Rules, setRule } from "@remuse/core";
import { Permission, ToolKind } from "@remuse/protocol";
import { z } from "zod";

const File = z.record(z.string(), z.partialRecord(ToolKind, Permission));

export function fileRules(path: string): Rules {
  let all: Record<string, AppRules> = existsSync(path) ? File.parse(JSON.parse(readFileSync(path, "utf8"))) : {};
  return {
    of: async (app) => ({ ...all[app] }),
    async set(app, kind, permission) {
      all = setRule(all, app, kind, permission);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const next = `${path}.next`;
      writeFileSync(next, JSON.stringify(all, null, 2), { mode: 0o600 });
      renameSync(next, path);
    },
  };
}
