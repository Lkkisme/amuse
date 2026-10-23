/**
 * Where the server keeps its data, and the start-up that comes first: the folders it needs are checked, the database is
 * opened, and its migrations are run (db/). Nothing else opens the data before this has finished; when it cannot, it
 * throws a StartupError, whose Problem the start-up page (startup.ts) puts in words.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Db, StartupError, dataMigrations, loadMigrations, migrate, openDatabase, preflight } from "@amuse/db";

export interface Location {
  /** the folder everything is kept in */
  dir: string;
  /** where the old journal was (imported once, then kept as events.jsonl.bak) */
  journal: string;
  database: string;
  backups: string;
}

/**
 *   AMUSE_DATA     the data folder
 *   AMUSE_JOURNAL  the older way to say it: the old journal's file, with the data folder as its folder
 * With neither, a temporary folder that goes with this run.
 */
export function locate(env: NodeJS.ProcessEnv): Location {
  const data = env["AMUSE_DATA"];
  const journal = env["AMUSE_JOURNAL"];
  const dir = data ?? (journal ? dirname(journal) : mkdtempSync(join(tmpdir(), "amuse-data-")));
  return { dir, journal: journal ?? join(dir, "events.jsonl"), database: join(dir, "amuse.db"), backups: join(dir, "backups") };
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The database, migrated; throws a StartupError (and leaves nothing open) when it cannot be. */
export async function openData(location: Location, log: (message: string) => void = console.log): Promise<Db> {
  preflight([
    { path: location.dir, create: true, hint: "data-volume" },
    { path: location.backups, create: true, hint: "data-volume" },
    // made by the first start, and by compose's sandbox-init before it (as the sandbox mounts it): theirs to be right
    { path: join(location.dir, "workspace"), create: true, hint: "compose-up" },
  ]);
  let db: Db;
  try {
    db = openDatabase(location.database);
  } catch (error) {
    throw new StartupError({ kind: "database-unreadable", path: location.database, message: said(error) }, said(error));
  }
  try {
    const report = await migrate(db, await loadMigrations(dataMigrations), { backups: location.backups, context: { dataDir: location.dir, journal: location.journal, log } });
    if (report.backup) log(`database: a copy from before the update is ${report.backup}`);
    for (const m of report.ran) log(`database: migration ${m.version}_${m.name} done`);
    return db;
  } catch (error) {
    db.close();
    if (error instanceof StartupError) throw error;
    throw new StartupError({ kind: "database-unreadable", path: location.database, message: said(error) }, said(error));
  }
}
