/**
 * What can stop Amuse from starting, as values: the runner and the preflight say what went wrong in these, and the page that
 * explains it (api/src/startup.ts) puts them in words, in each language. Nothing here is worded.
 */

/** What to tell the owner to do about a folder (a closed list: each has its words on the page). */
export type Hint = "compose-up" | "data-volume";

export type Problem =
  | { kind: "folder"; path: string; trouble: "missing" | "not-a-folder" | "not-writable"; hint: Hint }
  /** The database was written by a newer Amuse: `needed` is the newest migration in it that this one does not have. */
  | { kind: "database-newer"; needed: string; known: string | null }
  | { kind: "database-unreadable"; path: string; message: string }
  | { kind: "backup-failed"; message: string }
  /** A migration failed and was rolled back; `backup` is the snapshot taken before this run (null: there was none to take). */
  | { kind: "migration-failed"; version: string; name: string; message: string; backup: string | null };

/** Thrown when start-up must stop; `problem` is what to show. */
export class StartupError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem, message: string) {
    super(message);
    this.problem = problem;
  }
}
