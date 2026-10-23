/**
 * The data commands, run beside the server (in Docker: `docker compose exec amuse node api/src/cli.ts <command>`), on the
 * data folder named by AMUSE_DATA (or AMUSE_JOURNAL's folder), or `--data <folder>`:
 *   migrate [--dry-run]   run the pending migrations now (as the server does at start), or say what they would do
 *   rollback              undo the newest migration (it must have a way back)
 *   export [chat]         the chat's journal as JSONL on stdout (the main chat by default): the format the old events.jsonl had
 *   chats                 the chats, with how many events each has
 *   reset-password        forget the master password and every session: the next visit sets a new one
 *   schema                write db/schema.sql from the migrations
 */
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type Db, MEMORY, StartupError, applied, migrate, dataMigrations, describePending, dumpSchema, loadMigrations, openDatabase, plan, refuseNewer, revert } from "@amuse/db";
import { MAIN } from "@amuse/protocol";
import { z } from "zod";
import { resetPassword } from "./access.ts";
import { type Location, locate, openData } from "./data.ts";
import { explain } from "./startup.ts";
import { exported } from "./journal.ts";

const schemaFile = fileURLToPath(new URL("../../db/schema.sql", import.meta.url));

function usage(): never {
  console.error("usage: node api/src/cli.ts [--data <folder>] migrate [--dry-run] | rollback | export [chat] | chats | reset-password | schema");
  return process.exit(2);
}

async function dryRun(where: Location): Promise<void> {
  const known = await loadMigrations(dataMigrations);
  // read-only, and not made if it is not there
  const db = existsSync(where.database) ? new DatabaseSync(where.database, { readOnly: true }) : null;
  try {
    const found = plan(db ? applied(db) : [], known);
    refuseNewer(found, known);
    console.log(`${where.database}: ${db ? `${found.applied.length} migration${found.applied.length === 1 ? "" : "s"} applied` : "not there yet"}`);
    if (found.pending.length === 0) return void console.log("Nothing to run.");
    console.log(found.applied.length > 0 ? `A copy of the database is made in ${where.backups} first.` : "A new database: nothing to copy first.");
    for (const m of describePending(found, { dataDir: where.dir, journal: where.journal, log: console.log })) {
      console.log(`would run ${m.version}_${m.name} (${m.kind === "sql" ? "SQL" : "TypeScript"}):`);
      for (const touch of m.touches) console.log(`  ${touch}`);
    }
  } finally {
    db?.close();
  }
}

async function main(argv: string[]): Promise<void> {
  const args = [...argv];
  const flag = args.indexOf("--data");
  const env = { ...process.env };
  if (flag !== -1) {
    const folder = args[flag + 1];
    if (!folder) usage();
    env["AMUSE_DATA"] = folder;
    args.splice(flag, 2);
  }
  const [command, ...rest] = args;
  if (command === "schema") {
    // from the migrations alone, in a database that is only in memory
    const db = openDatabase(MEMORY);
    
    await migrate(db, await loadMigrations(dataMigrations), { backups: "", context: { dataDir: "", journal: "", log: () => {} } });
    writeFileSync(schemaFile, dumpSchema(db));
    return void console.log(`wrote ${schemaFile}`);
  }
  if (!env["AMUSE_DATA"] && !env["AMUSE_JOURNAL"]) {
    console.error("Say which data: --data <folder>, or AMUSE_DATA.");
    return process.exit(2);
  }
  const where = locate(env);
  if (command === "migrate" && rest.includes("--dry-run")) return dryRun(where);
  const db: Db = await openData(where);
  try {
    switch (command) {
      case "migrate":
        return void console.log("The database is up to date.");
      case "rollback": {
        const undone = revert(db, await loadMigrations(dataMigrations), { dataDir: where.dir, journal: where.journal, log: console.log });
        return void console.log(undone ? `undid ${undone.version}_${undone.name}` : "Nothing to undo.");
      }
      case "export": {
        const chat = rest[0] ?? MAIN;
        for (const line of exported(db, chat)) process.stdout.write(line);
        return;
      }
      case "chats": {
        const rows = db.prepare("select id, title, (select count(*) from events where chat = chats.id) as events from chats order by at, id").all();
        for (const row of rows.map((r) => z.object({ id: z.string(), title: z.string(), events: z.number() }).parse(r))) console.log(`${row.id}\t${row.events} events\t${row.title}`);
        return;
      }
      case "reset-password":
        resetPassword(db);
        return void console.log("The password is forgotten. The next visit sets a new one.");
      default:
        usage();
    }
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  if (error instanceof StartupError) console.error(`${explain(error.problem, "en").what}\n${explain(error.problem, "en").todo}`);
  else console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
