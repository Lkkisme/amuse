import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { MEMORY, type Db, openDatabase } from "./open.ts";
import { type Context, loadMigrations } from "./migrations.ts";
import { migrate } from "./migrate.ts";
import { dataMigrations } from "./data.ts";

const made: string[] = [];

/** A folder in the system's temporary one, removed when the process ends: tests do not leave their folders behind. */
export function tempFolder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (made.length === 0) process.once("exit", () => made.forEach((folder) => {
    const target = resolve(folder);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("amuse-")) throw new Error("Refusing cleanup outside an Amuse test folder");
    try { rmSync(target, { recursive: true, force: true }); }
    catch (error) {
      // Windows keeps SQLite files locked until the process closes its native handles.
      // The outer test runner can remove these exact folders once this process exits.
      if (process.platform === "win32" && ["EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? ""))
        console.warn(`AMUSE_TEST_CLEANUP ${target}`);
      else throw error;
    }
  }));
  made.push(dir);
  return dir;
}

/** A database with every migration run, for tests: in memory, or in a file in `dir`. Its data folder is empty, so nothing is imported. */
export async function migratedDatabase(dir?: string): Promise<Db> {
  const folder = dir ?? tempFolder("amuse-db-");
  const db = openDatabase(dir === undefined ? MEMORY : join(folder, "amuse.db"));
  await migrate(db, await loadMigrations(dataMigrations), { backups: join(folder, "backups"), context: { dataDir: folder, journal: join(folder, "events.jsonl"), secretsDir: join(folder, "secret-key"), log: () => {} } });
  return db;
}

const known = await loadMigrations(dataMigrations);

/**
 * A database with every migration run, made at once (no backups, no report): for tests of a store that need the tables and
 * nothing more. In memory, or in a file in `dir`; `context` is for the migrations that import old files (none are there by default).
 */
export function migratedNow(dir?: string, context: Partial<Omit<Context, "db">> = {}): Db {
  const folder = dir ?? tempFolder("amuse-db-");
  const db = openDatabase(dir === undefined ? MEMORY : join(folder, "amuse.db"));
  const full: Omit<Context, "db"> = { dataDir: folder, journal: join(folder, "events.jsonl"), secretsDir: join(folder, "secret-key"), log: () => {}, ...context };
  for (const migration of known) {
    if (migration.kind === "sql") db.exec(migration.up);
    else migration.up({ ...full, db })?.();
  }
  return db;
}
