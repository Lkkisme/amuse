/**
 * The event log as a JSONL file (one Envelope per line, mode 600). Lines are
 * parsed with the protocol schema on load; loading stops at the first line
 * that is not the next valid event, so a torn final write is dropped rather
 * than replayed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Journal } from "@remuse/core";
import { Envelope } from "@remuse/protocol";

export function fileJournal(path: string): Journal {
  return {
    load() {
      if (!existsSync(path)) return [];
      const log: Envelope[] = [];
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          break;
        }
        const parsed = Envelope.safeParse(raw);
        if (!parsed.success || parsed.data.seq !== log.length + 1) break;
        log.push(parsed.data);
      }
      return log;
    },
    append(envelope) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    },
  };
}
