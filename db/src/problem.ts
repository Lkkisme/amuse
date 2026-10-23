/**
 * What can stop Amuse from starting, as values: the runner and the preflight say what went wrong in these, and the page that
 * explains it (api/src/startup.ts) puts them in words, in each language. Nothing here is worded.
 */

/** What to tell the owner to do about a folder (a closed list: each has its words on the page). */
export type Hint = "compose-up" | "data-volume";

/** The folders the start checks, by what they are for (the page names them so, never by their paths). */
export type Folder = "data" | "backups" | "workspace";

/**
 * Values carry what the log needs (paths, the raw message); the page shows only the kind, the step and the hint,
 * since it is seen before anyone has signed in and the raw messages can echo what is in the files.
 */
export type Problem =
  /** AMUSE_DATA is set but empty, or says another folder than AMUSE_JOURNAL's. */
  | { kind: "configuration"; trouble: "empty-data" | "folders-differ" }
  | { kind: "folder"; folder: Folder; path: string; trouble: "missing" | "not-a-folder" | "not-writable"; hint: Hint }
  /** The database was written by a newer Amuse: `needed` is the newest migration in it that this one does not have. */
  | { kind: "database-newer"; needed: string; known: string | null }
  | { kind: "database-unreadable"; path: string; message: string }
  | { kind: "backup-failed"; message: string }
  /** A migration failed and was rolled back; `backup` is the snapshot taken before this run (null: there was none to take). */
  | { kind: "migration-failed"; version: string; name: string; message: string; backup: string | null }
  /** A chat's journal in the database is not a run of valid events, `event` being the first that is not. */
  | { kind: "journal-unreadable"; chat: string; event: number }
  /** The old files (events.jsonl, access.json …) are beside a database that has already imported them. */
  | { kind: "old-files"; files: string[] };

/** Thrown when start-up must stop; `problem` is what to show. */
export class StartupError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem, message: string) {
    super(message);
    this.problem = problem;
  }
}
