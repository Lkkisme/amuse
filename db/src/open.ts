/**
 * The one database file, opened the one way: WAL, foreign keys on, a wait for a
 * busy lock, every commit on disk before it returns, and the file the owner's
 * alone (mode 600, as its -wal and -shm files then are).
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { z } from "zod";

export type Db = DatabaseSync;
export const MEMORY = ":memory:";
/** How long a writer waits for another's lock before it fails (a second process, say the CLI, working at the same time). */
export const BUSY_MS = 5000;

export function openDatabase(path: string): Db {
  if (path !== MEMORY) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // made by us at 600 before SQLite can make it at the umask's, and put right if it was left wider
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path);
  db.exec(`pragma busy_timeout = ${BUSY_MS}`);
  const mode = db.prepare("pragma journal_mode = wal").get();
  const kept = mode ? Object.values(mode)[0] : null;
  if (path !== MEMORY && kept !== "wal") {
    db.close();
    throw new Error(`${path}: this folder's file system cannot keep a database in WAL mode (it answered ${String(kept)}). Keep the data on a local disk or a Docker volume.`);
  }
  db.exec("pragma synchronous = full; pragma foreign_keys = on");
  return db;
}

/**
 * To look at a database that exists, and leave it exactly as it is. SQLite makes the -wal and -shm files even for a read-only
 * connection, so when there is no -wal (nothing is using the database) it is opened immutable, with no files made at all; when
 * there is one (the server is running), the usual read-only connection sees what the server has written.
 */
export function openReadOnly(path: string): Db {
  if (existsSync(`${path}-wal`)) return new DatabaseSync(path, { readOnly: true });
  return new DatabaseSync(`${pathToFileURL(path).href}?mode=ro&immutable=1`);
}

/** Rows as `schema` reads them (a column that is not what the schema says is an error, not a surprise later). */
export function query<S extends z.ZodType>(db: Db, schema: S, sql: string, ...params: SQLInputValue[]): z.output<S>[] {
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => schema.parse(row));
}

/** The row, or null when there is none. */
export function queryOne<S extends z.ZodType>(db: Db, schema: S, sql: string, ...params: SQLInputValue[]): z.output<S> | null {
  const row = db.prepare(sql).get(...params);
  return row === undefined ? null : schema.parse(row);
}

let savepoints = 0;

/**
 * `work` all or nothing: committed when it returns, rolled back when it throws. Inside another transaction it is a savepoint, so a
 * store can keep its own writes whole whether or not a migration (or a caller's larger change) has one open around it.
 */
export function transaction<T>(db: Db, work: () => T): T {
  const nested = db.isTransaction;
  const name = `amuse_${(savepoints += 1)}`;
  db.exec(nested ? `savepoint ${name}` : "begin immediate");
  try {
    const result = work();
    db.exec(nested ? `release ${name}` : "commit");
    return result;
  } catch (error) {
    // SQLite may have rolled back already (a constraint with ON CONFLICT ROLLBACK, a full disk): then there is nothing to undo, and
    // asking would replace the error that matters with "no transaction is active"
    if (db.isTransaction) db.exec(nested ? `rollback to ${name}; release ${name}` : "rollback");
    throw error;
  }
}
