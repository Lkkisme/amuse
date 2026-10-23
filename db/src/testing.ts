import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY, type Db, openDatabase } from "./open.ts";
import { loadMigrations } from "./migrations.ts";
import { migrate } from "./migrate.ts";
import { dataMigrations } from "./data.ts";

const made: string[] = [];

/** A folder in the system's temporary one, removed when the process ends: tests do not leave their folders behind. */
export function tempFolder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (made.length === 0) process.once("exit", () => made.forEach((folder) => rmSync(folder, { recursive: true, force: true })));
  made.push(dir);
  return dir;
}

/** A database with every migration run, for tests: in memory, or in a file in `dir`. Its data folder is empty, so nothing is imported. */
export async function migratedDatabase(dir?: string): Promise<Db> {
  const folder = dir ?? tempFolder("amuse-db-");
  const db = openDatabase(dir === undefined ? MEMORY : join(folder, "amuse.db"));
  await migrate(db, await loadMigrations(dataMigrations), { backups: join(folder, "backups"), context: { dataDir: folder, journal: join(folder, "events.jsonl"), log: () => {} } });
  return db;
}
