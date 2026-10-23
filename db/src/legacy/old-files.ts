/**
 * The old files beside a database that has already imported them. After migration 1 the server never reads them again, so
 * if they are there (a crash between the commit and the rename, or an older version that was run on this data and wrote
 * them), the start refuses rather than ignore them: an older version would have started with no password and no history.
 * `retireOldFiles` finishes the rename, for the files that are exactly what was imported and no others.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import type { Context } from "../migrations.ts";
import { type Db, query } from "../open.ts";

const SIDE = /^(.+)\.jsonl$/;

/** The old files that are there: the journal, the other JSON files, and the side chats' journals of chats the database has. */
export function oldFilesBeside(db: Db, context: Omit<Context, "db">): string[] {
  const chats = new Set(query(db, z.object({ id: z.string() }), "select id from chats").map((c) => c.id));
  const fixed = [context.journal, ...["chats.json", "rules.json", "access.json", "defaults.json", "sent.json"].map((name) => join(context.dataDir, name))];
  const sideDir = join(context.dataDir, "chats");
  const side = existsSync(sideDir)
    ? readdirSync(sideDir)
        .filter((name) => chats.has(SIDE.exec(name)?.[1] ?? ""))
        .map((name) => join(sideDir, name))
    : [];
  return [...fixed, ...side].filter((path) => existsSync(path)).map((path) => relative(context.dataDir, path));
}

/** `path`.bak, or the first of .bak.2, .bak.3 … that is free: an earlier import's file is never written over. */
export function retired(path: string): string {
  for (let n = 1; ; n++) {
    const target = n === 1 ? `${path}.bak` : `${path}.bak.${n}`;
    if (!existsSync(target)) return target;
  }
}

/** Rename each old file that is, byte for byte, what imported_files says was imported; say which were, and which were not (they differ, or were never imported). */
export function retireOldFiles(db: Db, context: Omit<Context, "db">): { renamed: string[]; kept: string[] } {
  const imported = new Map(query(db, z.object({ name: z.string(), sha256: z.string() }), "select name, sha256 from imported_files").map((row) => [row.name, row.sha256]));
  const renamed: string[] = [];
  const kept: string[] = [];
  for (const name of oldFilesBeside(db, context)) {
    const path = join(context.dataDir, name);
    const same = imported.get(name) === createHash("sha256").update(readFileSync(path)).digest("hex");
    if (same) {
      renameSync(path, retired(path));
      renamed.push(name);
    } else kept.push(name);
  }
  return { renamed, kept };
}
