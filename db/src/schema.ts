/**
 * db/schema.sql: the database as the migrations leave it, in dbmate's shape (the statements, then the versions
 * applied), kept in the repo and checked against the migrations by a test. `amuse schema` writes it.
 */
import { z } from "zod";
import { TABLE, applied } from "./migrate.ts";
import { type Db, query } from "./open.ts";

const Statement = z.object({ sql: z.string() });

export function dumpSchema(db: Db): string {
  const statements = query(db, Statement, "select sql from sqlite_master where sql is not null and name not like 'sqlite!_%' escape '!' order by rowid");
  const versions = applied(db);
  return [
    ...statements.map(({ sql }) => `${sql};\n`),
    "\n",
    "-- Dbmate schema migrations\n",
    `INSERT INTO ${TABLE} (version) VALUES\n${versions.map((v) => `  ('${v}')`).join(",\n")};\n`,
  ].join("").replaceAll("\r\n", "\n");
}
