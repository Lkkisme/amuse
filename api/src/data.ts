/**
 * Where the server keeps its data, and the start-up that comes first: the folders it needs are checked, the database is
 * opened, and its migrations are run (db/). Nothing else opens the data before this has finished; when it cannot, it
 * throws a StartupError, whose Problem the start-up page (startup.ts) puts in words.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { Envelope } from "@amuse/protocol";
import { dirname, join, resolve } from "node:path";
import { type Db, StartupError, applied, dataMigrations, loadMigrations, migrate, openDatabase, oldFilesBeside, plan, preflight, refuseNewer } from "@amuse/db";

export interface Location {
  /** the folder everything is kept in */
  dir: string;
  /** where the old journal was (imported once, then kept as events.jsonl.bak) */
  journal: string;
  database: string;
  backups: string;
  /** the folder the Vault's key lives in, apart from the data (AMUSE_SECRETS_DIR; without it, beside the data) */
  secrets: string;
  /** whether AMUSE_SECRETS_DIR named it: a folder that is a mount, which must be there, not one of ours to make */
  secretsMounted: boolean;
}

/**
 *   AMUSE_DATA     the data folder
 *   AMUSE_JOURNAL  the older way to say it: the old journal's file, with the data folder as its folder
 * With neither, a temporary folder that goes with this run. An empty AMUSE_DATA is a mistake (a variable set to nothing, in a
 * compose file) and is refused, not read as no folder; so is an AMUSE_DATA that is not the folder of AMUSE_JOURNAL, since the old
 * files are read from where the journal is and must never be imported into another folder's database.
 */
export function locate(env: NodeJS.ProcessEnv): Location {
  const data = env["AMUSE_DATA"];
  const journal = env["AMUSE_JOURNAL"] || undefined;
  if (data === "") throw new StartupError({ kind: "configuration", trouble: "empty-data" }, "AMUSE_DATA is set but empty");
  if (data && journal && resolve(dirname(journal)) !== resolve(data))
    throw new StartupError({ kind: "configuration", trouble: "folders-differ" }, `AMUSE_DATA (${data}) is not the folder of AMUSE_JOURNAL (${journal})`);
  const dir = data ?? (journal ? dirname(journal) : mkdtempSync(join(tmpdir(), "amuse-data-")));
  const secrets = env["AMUSE_SECRETS_DIR"] || undefined;
  return { dir, journal: journal ?? join(dir, "events.jsonl"), database: join(dir, "amuse.db"), backups: join(dir, "backups"), secrets: secrets ?? join(dir, "secret-key"), secretsMounted: secrets !== undefined };
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The database, migrated; throws a StartupError (and leaves nothing open) when it cannot be. */
export async function openData(location: Location, log: (message: string) => void = console.log): Promise<Db> {
  preflight([
    { folder: "data", path: location.dir, create: true, hint: "data-volume" },
    { folder: "backups", path: location.backups, create: true, hint: "data-volume" },
    // made by the first start, and by compose's sandbox-init before it (as the sandbox mounts it): theirs to be right
    { folder: "workspace", path: join(location.dir, "workspace"), create: true, hint: "compose-up" },
    // the Vault's key lives here, apart from the data: a mount (compose makes the folder for uid 1000), so it must be there; with
    // no AMUSE_SECRETS_DIR (development, tests) it is a folder beside the data that is made
    { folder: "secrets", path: location.secrets, create: !location.secretsMounted, hint: "key-folder" },
  ]);
  let db: Db;
  try {
    db = openDatabase(location.database);
  } catch (error) {
    throw new StartupError({ kind: "database-unreadable", path: location.database, message: said(error) }, said(error));
  }
  try {
    const context = { dataDir: location.dir, journal: location.journal, secretsDir: location.secrets, log, readable: (envelope: unknown) => Envelope.safeParse(envelope).success };
    const report = await migrate(db, await loadMigrations(dataMigrations), { backups: location.backups, context });
    if (report.backup) log(`database: a copy from before the update is ${report.backup}`);
    for (const m of report.ran) log(`database: migration ${m.version}_${m.name} done`);
    // the old files are imported and renamed; if they are still there, something else wrote them or the rename did not happen
    const old = oldFilesBeside(db, context);
    if (old.length > 0) throw new StartupError({ kind: "old-files", files: old }, `old files beside a database that has imported them: ${old.join(", ")}`);
    return db;
  } catch (error) {
    db.close();
    if (error instanceof StartupError) throw error;
    throw new StartupError({ kind: "database-unreadable", path: location.database, message: said(error) }, said(error));
  }
}

/**
 * A database that is already there, opened as it is, for the commands that only look or only change one thing: nothing is
 * made, no folder is checked, and no migration is run. If some are pending it says so (`allowPending` is for rollback, which
 * works on what is applied); a database newer than this code is refused as at start.
 */
export async function openExisting(location: Location, options: { allowPending: boolean } = { allowPending: false }): Promise<Db> {
  if (!existsSync(location.database)) throw new Error(`There is no database at ${location.database}: start Amuse once, or run migrate.`);
  const db = openDatabase(location.database);
  try {
    const known = await loadMigrations(dataMigrations);
    const found = plan(applied(db), known);
    refuseNewer(found, known);
    if (found.pending.length > 0 && !options.allowPending) throw new Error(`${found.pending.length} migration${found.pending.length === 1 ? " is" : "s are"} pending: run \`amuse-admin migrate\` first.`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
