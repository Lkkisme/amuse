/**
 * The chats and their event logs, in the database (db/migrations): a chat's journal is its rows in `events`, numbered
 * 1, 2, 3 … without gaps and only ever added to. Replay reads them as it goes, with the protocol schema, so the host
 * never holds the raw log: any row that is not the next valid event stops the start with an error, and the history is
 * never cut to fit. A deleted chat takes its events with it (the foreign key).
 */
import type { ChatStore, Journal } from "@amuse/core";
import { type Db, query, transaction } from "@amuse/db";
import { Chat, Envelope } from "@amuse/protocol";
import { z } from "zod";

const Row = z.object({ seq: z.number(), event: z.string() });

function parseEvent(event: string): unknown {
  try {
    return JSON.parse(event);
  } catch {
    return null;
  }
}

/** A chat's events from `after` on (0: all), in order, one at a time; a row that is not the next valid event is an error. */
export function* eventsOf(db: Db, chat: string, after = 0): Generator<Envelope> {
  let seq = after;
  for (const row of db.prepare("select seq, event from events where chat = ? and seq > ? order by seq").iterate(chat, after)) {
    const { seq: stored, event } = Row.parse(row);
    const parsed = Envelope.safeParse({ seq: stored, event: parseEvent(event) });
    if (!parsed.success || stored !== seq + 1) throw new Error(`the journal of the chat ${chat}: event ${seq + 1} is not the next event this version can read; restore a backup or export the journal and start over`);
    seq = stored;
    yield parsed.data;
  }
}

export function sqliteJournal(db: Db, chat: string): Journal {
  const insert = db.prepare("insert into events (chat, seq, event) values (?, ?, ?)");
  return {
    load: () => eventsOf(db, chat),
    append: (envelope) => void insert.run(chat, envelope.seq, JSON.stringify(envelope.event)),
  };
}

export function sqliteChats(db: Db): ChatStore {
  const upsert = db.prepare("insert into chats (id, title, at, updated) values (?, ?, ?, ?) on conflict (id) do update set title = excluded.title, at = excluded.at, updated = excluded.updated");
  return {
    load: () => query(db, Chat, "select id, title, at, updated from chats order by at, id"),
    // adds and changes; a chat goes only through `remove`, which takes its log with it
    save: (chats) => transaction(db, () => chats.forEach((chat) => upsert.run(chat.id, chat.title, chat.at, chat.updated))),
    journal: (chat) => sqliteJournal(db, chat),
    remove: (chat) => void db.prepare("delete from chats where id = ?").run(chat),
  };
}

/** The journal of a chat as the old file kept it, one JSON line per event (`amuse export`); what `fileJournal` read, so it can be read back. */
export function* exported(db: Db, chat: string): Generator<string> {
  for (const envelope of eventsOf(db, chat)) yield `${JSON.stringify(envelope)}\n`;
}
