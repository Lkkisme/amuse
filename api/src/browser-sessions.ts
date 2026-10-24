/** The browsers open on a controller, in the database: the node and the session each runs in, so a restart adopts them again (browser/src/pool.ts). */
import { type Db, query } from "@amuse/db";
import type { BrowserSessions } from "@amuse/browser";
import { z } from "zod";

const Row = z.object({ id: z.string(), node: z.string(), session: z.string() });

export function sqliteBrowserSessions(db: Db): BrowserSessions {
  return {
    list: () => query(db, Row, "select id, node, session from browser_sessions"),
    save: (id, node, session) =>
      void db
        .prepare("insert into browser_sessions (id, node, session) values (?, ?, ?) on conflict (id) do update set node = excluded.node, session = excluded.session")
        .run(id, node, session),
    forget: (id) => void db.prepare("delete from browser_sessions where id = ?").run(id),
  };
}
