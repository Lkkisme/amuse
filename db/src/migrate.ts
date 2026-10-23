/**
 * The runner. At start-up, before anything opens the data:
 *  - a database written by a newer Amuse (it has a migration this one does not) is refused;
 *  - when there are migrations to run and the database already holds some, it is copied first, online,
 *    to <backups>/<time>-pre-migrate.db;
 *  - each pending migration runs in a transaction of its own, with its row in schema_migrations; if it fails,
 *    it is rolled back and the start stops (earlier ones of this run stay: each was whole).
 * `schema_migrations(version)` is dbmate's own table, so the dbmate CLI can be pointed at the same file in development.
 */
import { chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { z } from "zod";
import { type Context, type Finish, type Migration, touchedBy } from "./migrations.ts";
import { type Db, query, transaction } from "./open.ts";
import { StartupError } from "./problem.ts";

const Version = z.object({ version: z.string() });

/** dbmate's, for SQLite. */
export const TABLE = "schema_migrations";
const create = `create table if not exists ${TABLE} (version varchar(255) primary key)`;

/** The versions applied, oldest first; none when the table is not there yet. */
export function applied(db: Db): string[] {
  const there = db.prepare("select 1 as there from sqlite_master where type = 'table' and name = ?").get(TABLE);
  return there ? query(db, Version, `select version from ${TABLE} order by version`).map((row) => row.version) : [];
}

export interface Plan {
  applied: string[];
  /** Not yet applied, in the order they will run. */
  pending: Migration[];
  /** Applied but not known to this code: the database is from a newer Amuse. */
  newer: string[];
}

export function plan(done: readonly string[], known: readonly Migration[]): Plan {
  const have = new Set(known.map((m) => m.version));
  const was = new Set(done);
  return {
    applied: [...done],
    pending: known.filter((m) => !was.has(m.version)),
    newer: done.filter((v) => !have.has(v)),
  };
}

/** The refusal for a database that is ahead of this code (checked first, on every start). */
export function refuseNewer(found: Plan, known: readonly Migration[]): void {
  const needed = found.newer.at(-1);
  if (needed === undefined) return;
  throw new StartupError({ kind: "database-newer", needed, known: known.at(-1)?.version ?? null }, `the database has migration ${needed}, which this version does not know`);
}

export interface Described {
  version: string;
  name: string;
  kind: "sql" | "code";
  /** What it touches, in words. */
  touches: string[];
}

/** The pending migrations and what each touches, without running or changing anything. */
export function describePending(found: Plan, context: Omit<Context, "db">): Described[] {
  return found.pending.map((m) => ({
    version: m.version,
    name: m.name,
    kind: m.kind,
    touches: m.kind === "sql" ? touchedBy(m.up) : m.describe(context),
  }));
}

export interface Options {
  /** Where the pre-migrate snapshots go. */
  backups: string;
  context: Omit<Context, "db">;
  now?: () => Date;
}

export interface Report {
  /** The migrations run now. */
  ran: Migration[];
  /** The snapshot taken first, if one was. */
  backup: string | null;
}

const stamp = (when: Date) => when.toISOString().replace(/[:.]/g, "-");

/** An online copy of the database (the server may be holding it open), mode 600. */
export async function snapshot(db: Db, directory: string, label: string, now: () => Date = () => new Date(), copy: (from: Db, to: string) => Promise<unknown> = backup): Promise<string> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${stamp(now())}-${label}.db`);
  try {
    await copy(db, target);
    chmodSync(target, 0o600);
  } catch (error) {
    // what a full disk leaves is half a copy, which must not be taken for a whole one later
    rmSync(target, { force: true });
    throw error;
  }
  return target;
}

/** How many pre-migrate copies are kept (the newest). */
export const BACKUPS_KEPT = 5;

/** Remove the oldest copies made by `label`, keeping the newest `keep`: their names start with the time, so they sort by it. */
export function prune(directory: string, label: string, keep: number = BACKUPS_KEPT): string[] {
  const copies = readdirSync(directory).filter((name) => name.endsWith(`-${label}.db`)).sort();
  const gone = copies.slice(0, Math.max(0, copies.length - keep));
  for (const name of gone) rmSync(join(directory, name), { force: true });
  return gone;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function migrate(db: Db, known: readonly Migration[], options: Options): Promise<Report> {
  const found = plan(applied(db), known);
  refuseNewer(found, known);
  if (found.pending.length === 0) return { ran: [], backup: null };
  let kept: string | null = null;
  // nothing applied yet: a new database, or the first run, whose old files are kept beside it; there is nothing to snapshot
  if (found.applied.length > 0) {
    try {
      kept = await snapshot(db, options.backups, "pre-migrate", options.now);
    } catch (error) {
      throw new StartupError({ kind: "backup-failed", message: message(error) }, `could not back up the database: ${message(error)}`);
    }
    // the copy is made; an old one that cannot be removed is no reason not to start
    try {
      prune(options.backups, "pre-migrate");
    } catch (error) {
      options.context.log(`database: the older copies in the backups folder could not be removed (${message(error)}); the update goes on.`);
    }
  }
  db.exec(create);
  const ran: Migration[] = [];
  for (const migration of found.pending) {
    const context = { ...options.context, db };
    let finish: Finish | void;
    try {
      finish = transaction(db, () => {
        const after = migration.kind === "sql" ? db.exec(migration.up) : migration.up(context);
        db.prepare(`insert into ${TABLE} (version) values (?)`).run(migration.version);
        return after;
      });
    } catch (error) {
      throw new StartupError(
        { kind: "migration-failed", version: migration.version, name: migration.name, message: message(error), backup: kept },
        `migration ${migration.version}_${migration.name} failed and was rolled back: ${message(error)}`,
      );
    }
    ran.push(migration);
    try {
      finish?.();
    } catch (error) {
      // the migration is committed; what was left undone is said, and the start goes on
      options.context.log(`migration ${migration.version}_${migration.name} is done, but its last step failed: ${message(error)}`);
    }
  }
  return { ran, backup: kept };
}

/** Undo the newest applied migration (development, or going back a release with its backup at hand): false when there is none. */
export function revert(db: Db, known: readonly Migration[], context: Omit<Context, "db">): Migration | false {
  const done = applied(db);
  refuseNewer(plan(done, known), known);
  const last = known.find((m) => m.version === done.at(-1));
  if (!last) return false;
  if (last.down === null) throw new Error(`${last.version}_${last.name} has no way back (no migrate:down)`);
  transaction(db, () => {
    if (last.kind === "sql" && last.down !== null) db.exec(last.down);
    else if (last.kind === "code" && last.down !== null) last.down({ ...context, db });
    db.prepare(`delete from ${TABLE} where version = ?`).run(last.version);
  });
  return last;
}
