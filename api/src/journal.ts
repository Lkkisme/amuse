/**
 * The event log as a JSONL file (one Envelope per line, mode 600). Lines are
 * parsed with the protocol schema on load. A torn final write (a last line
 * without its newline) is cut off, so the next append starts on a clean
 * line instead of gluing onto it. Any whole line that is not the next valid
 * event — another version's format, a gap — stops the load with an error:
 * the history is never cut to fit.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ChatStore, Journal } from "@remuse/core";
import { Chat, Envelope, MAIN } from "@remuse/protocol";
import { z } from "zod";

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function fileJournal(path: string): Journal {
  return {
    load() {
      if (!existsSync(path)) return [];
      const content = readFileSync(path);
      const log: Envelope[] = [];
      let valid = 0; // bytes of the valid prefix, newline included
      for (let start = 0; start < content.length;) {
        const end = content.indexOf(0x0a, start);
        if (end === -1) break; // no newline: a torn last write
        const parsed = Envelope.safeParse(
          parseLine(content.subarray(start, end).toString("utf8")),
        );
        if (!parsed.success || parsed.data.seq !== log.length + 1)
          throw new Error(
            `${path}: line ${log.length + 1} is not the next event this version can read; move the file aside to start over`,
          );
        log.push(parsed.data);
        start = valid = end + 1;
      }
      if (valid < content.length) truncateSync(path, valid);
      return log;
    },
    append(envelope) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    },
  };
}

/** A side chat's id as a file name: only ids the host makes (letters, digits, dashes) ever reach the disk. */
const safeId = /^[A-Za-z0-9-]{1,80}$/;

/**
 * Chats on disk: the main chat's log where it always was (`main`), each side
 * chat's at `<dir>/chats/<id>.jsonl`, and the list of chats at
 * `<dir>/chats.json` (written whole through a temporary file, mode 600).
 */
export function fileChats(dir: string, main: string): ChatStore {
  const list = join(dir, "chats.json");
  const path = (chat: string) => {
    if (chat === MAIN) return main;
    if (!safeId.test(chat)) throw new Error(`not a chat id: ${chat}`);
    return join(dir, "chats", `${chat}.jsonl`);
  };
  return {
    load: () =>
      existsSync(list)
        ? z.array(Chat).parse(JSON.parse(readFileSync(list, "utf8")))
        : [],
    save(chats) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temporary = `${list}.next`;
      writeFileSync(temporary, JSON.stringify(chats, null, 2), { mode: 0o600 });
      renameSync(temporary, list);
    },
    journal: (chat) => fileJournal(path(chat)),
    remove: (chat) => rmSync(path(chat), { force: true }),
  };
}
