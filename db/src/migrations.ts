/**
 * The migrations in a folder, in one ordered sequence. Two kinds sit side by side:
 *   <version>_<name>.sql   dbmate's format: `-- migrate:up` and `-- migrate:down` sections
 *   <version>_<name>.ts    for what SQL cannot do (importing old files, sealing secrets): exports `up`, `describe`, and
 *                          optionally `down`; see CodeMigration
 * The version is a timestamp, YYYYMMDDHHMMSS, as dbmate makes them; migrations run in the order of their versions.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Db } from "./open.ts";

/** What a code migration is given. */
export interface Context {
  /** The database, inside the migration's own transaction. */
  db: Db;
  /** The folder the server keeps its data in. */
  dataDir: string;
  /** Where the old journal lived (events.jsonl, or whatever AMUSE_JOURNAL named). */
  journal: string;
  /** The folder the Vault's key lives in, apart from the data (AMUSE_SECRETS_DIR). */
  secretsDir: string;
  /** Said in the server's log. */
  log(message: string): void;
  /**
   * Whether the running version can read an event (the live schema, which a frozen migration must not import): given by the server,
   * so an import refuses, before it changes anything, an event that would only fail at replay. Without it, the import checks shape only.
   */
  readable?: (envelope: unknown) => boolean;
}

/** Work to do once the migration has committed (renaming the files it imported, say); a failure there is said, not undone. */
export type Finish = () => void;

export interface SqlMigration {
  kind: "sql";
  version: string;
  name: string;
  up: string;
  down: string | null;
}

export interface CodeMigration {
  kind: "code";
  version: string;
  name: string;
  /** Change the database in `context.db`, which is inside the transaction; the result, if any, runs after the commit. */
  up(context: Context): Finish | void;
  /** Undo `up`; none when it cannot be undone. */
  down: ((context: Context) => void) | null;
  /** What `up` would touch right now, in words, without changing anything (for the dry run). */
  describe(context: Omit<Context, "db">): string[];
}

export type Migration = SqlMigration | CodeMigration;

const FILE = /^(\d{14})_([a-z0-9_]+)\.(sql|ts)$/;

/**
 * dbmate's sections. Anything before `-- migrate:up` must be a comment; `transaction:false` is dbmate's, and not one
 * Amuse has a use for (every migration here is one transaction), so it is refused rather than half-honoured.
 */
export function parseSql(file: string, text: string): { up: string; down: string | null } {
  const marks = [...text.matchAll(/^--\s*migrate:(up|down)\b(.*)$/gim)];
  const first = marks[0];
  if (!first || first[1]?.toLowerCase() !== "up") throw new Error(`${file}: it must begin with "-- migrate:up"`);
  const sections = new Map<string, string>();
  marks.forEach((mark, i) => {
    const which = (mark[1] ?? "").toLowerCase();
    if (sections.has(which)) throw new Error(`${file}: "-- migrate:${which}" appears twice`);
    if (/transaction\s*:\s*false/i.test(mark[2] ?? "")) throw new Error(`${file}: transaction:false is not supported; migrations here are one transaction each`);
    const from = (mark.index ?? 0) + mark[0].length;
    const to = marks[i + 1]?.index ?? text.length;
    sections.set(which, text.slice(from, to).trim());
  });
  const up = sections.get("up") ?? "";
  if (up === "") throw new Error(`${file}: the migrate:up section is empty`);
  const down = sections.get("down");
  return { up, down: down === undefined || down === "" ? null : down };
}

const Run = z.custom<(context: Context) => Finish | void>((v) => typeof v === "function");
const Down = z.custom<(context: Context) => void>((v) => typeof v === "function");
const Describe = z.custom<(context: Omit<Context, "db">) => string[]>((v) => typeof v === "function");
const Module = z.object({ up: Run, describe: Describe, down: Down.optional() });

/** Every migration in `dir`, oldest first. A name that is not a migration's, or two with one version, is an error: the sequence must be certain. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const found: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    const match = FILE.exec(file);
    if (!match) {
      if (file.endsWith(".sql") || file.endsWith(".ts")) throw new Error(`${join(dir, file)}: a migration is named <14-digit version>_<name>.sql or .ts`);
      continue;
    }
    const [, version = "", name = "", extension] = match;
    if (extension === "sql") {
      const { up, down } = parseSql(file, readFileSync(join(dir, file), "utf8"));
      found.push({ kind: "sql", version, name, up, down });
    } else {
      const loaded: unknown = await import(pathToFileURL(join(dir, file)).href);
      const module = Module.safeParse(loaded);
      if (!module.success) throw new Error(`${file}: a code migration exports up(context) and describe(context), and optionally down(context)`);
      found.push({ kind: "code", version, name, up: module.data.up, down: module.data.down ?? null, describe: module.data.describe });
    }
  }
  found.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  for (let i = 1; i < found.length; i++) {
    if (found[i]?.version === found[i - 1]?.version) throw new Error(`${dir}: two migrations have the version ${found[i]?.version}`);
  }
  return found;
}

/** The tables a migration's SQL names, as "create table chats": what the dry run says a migration touches. */
export function touchedBy(sql: string): string[] {
  const code = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  const pattern = /\b(create\s+(?:unique\s+)?(?:virtual\s+)?(?:table|index|view|trigger)|alter\s+table|drop\s+(?:table|index|view|trigger)|insert\s+(?:or\s+\w+\s+)?into|delete\s+from|update)\s+(?:if\s+(?:not\s+)?exists\s+)?["`[]?(\w+)/gi;
  for (const match of code.matchAll(pattern)) found.add(`${(match[1] ?? "").toLowerCase().replace(/\s+/g, " ")} ${match[2] ?? ""}`);
  return [...found];
}
