/**
 * The journal as the old file kept it (one Envelope per line), read the way the old loader read it, for the import,
 * for the replay-equivalence test, and for nothing else. Every whole line must be the next valid event: a line of
 * another version's format, or a gap, is an error, and the history is never cut to fit. A torn last write is dropped.
 */
import { isDeepStrictEqual } from "node:util";
import { Envelope } from "./frozen.ts";
import { forEachLine } from "./lines.ts";

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * The event's JSON text as the line has it: between `{"seq":N,"event":` and the closing brace, which is how the server wrote every
 * line. When a line is some other shape, the event as parsed, written again.
 */
export function eventText(line: string, seq: number, event: unknown): string {
  const head = `{"seq":${seq},"event":`;
  if (line.startsWith(head) && line.endsWith("}")) {
    const text = line.slice(head.length, -1);
    try {
      if (isDeepStrictEqual(JSON.parse(text), event)) return text;
    } catch {
      // not the shape after all: written again below
    }
  }
  return JSON.stringify(event);
}

/** Each event of the old file, with its text as it was written. */
export function readJournalFile(path: string, each: (seq: number, event: string) => void): { bytes: number; sha256: string; events: number; torn: number } {
  let events = 0;
  const file = forEachLine(path, (line) => {
    const raw = parseLine(line);
    const parsed = Envelope.safeParse(raw);
    if (!parsed.success || parsed.data.seq !== events + 1)
      throw new Error(`${path}: line ${events + 1} is not the next event this version can read; move the file aside to start over`);
    events += 1;
    each(parsed.data.seq, eventText(line, parsed.data.seq, parsed.data.event));
  });
  return { ...file, events };
}
