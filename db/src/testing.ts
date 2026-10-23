import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY, type Db, openDatabase } from "./open.ts";
import { loadMigrations } from "./migrations.ts";
import { migrate } from "./migrate.ts";
import { dataMigrations } from "./data.ts";

/** A database with every migration run, for tests: in memory, or in a file in `dir`. Its data folder is empty, so nothing is imported. */
export async function migratedDatabase(dir?: string): Promise<Db> {
  const folder = dir ?? mkdtempSync(join(tmpdir(), "amuse-db-"));
  const db = openDatabase(dir === undefined ? MEMORY : join(folder, "amuse.db"));
  await migrate(db, await loadMigrations(dataMigrations), { backups: join(folder, "backups"), context: { dataDir: folder, journal: join(folder, "events.jsonl"), log: () => {} } });
  return db;
}
