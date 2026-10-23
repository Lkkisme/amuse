/** The index of sent files (who sent what, wherever it was moved to), in the database: the workspace reads it once and writes it whole on a change. */
import { type Db, query, transaction } from "@amuse/db";
import { Attachment } from "@amuse/protocol";
import { z } from "zod";
import type { Sent, SentIndex } from "./workspace.ts";

const Row = z.object({ id: z.string(), by: z.enum(["user", "muse"]), attachment: z.string() });

export function sqliteSent(db: Db): SentIndex {
  return {
    load: () => Object.fromEntries(query(db, Row, "select id, by, attachment from sent").map((row) => [row.id, { by: row.by, attachment: Attachment.parse(JSON.parse(row.attachment)) }])),
    save: (all) =>
      transaction(db, () => {
        db.exec("delete from sent");
        for (const [id, { by, attachment }] of Object.entries(all)) db.prepare("insert into sent (id, by, attachment) values (?, ?, ?)").run(id, by, JSON.stringify(attachment));
      }),
  };
}

/** The index kept in memory only (tests, the demo). */
export function memorySent(): SentIndex {
  let all: Record<string, Sent> = {};
  return { load: () => ({ ...all }), save: (next) => void (all = { ...next }) };
}
