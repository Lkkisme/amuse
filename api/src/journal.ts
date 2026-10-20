/**
 * The event log as a JSONL file (one Envelope per line, mode 600). Lines are
 * parsed with the protocol schema on load; loading stops at the first line
 * that is not the next valid event, and the file is cut back to the valid
 * prefix, so a torn final write is dropped rather than replayed — and the
 * next append starts on a clean line instead of gluing onto the torn one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { dirname } from "node:path";
import type { Journal } from "@remuse/core";
import { Envelope } from "@remuse/protocol";

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
      for (let start = 0; start < content.length; ) {
        const end = content.indexOf(0x0a, start);
        if (end === -1) break; // no newline: a torn last write
        const parsed = Envelope.safeParse(parseLine(content.subarray(start, end).toString("utf8")));
        if (!parsed.success || parsed.data.seq !== log.length + 1) break;
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
