/**
 * The journal as the old file kept it (one Envelope per line), read the way the old loader read it, for the import,
 * for the replay-equivalence test, and for nothing else. Every whole line must be the next valid event: a line of
 * another version's format, or a gap, is an error, and the history is never cut to fit. A torn last write is dropped.
 */
import { Envelope } from "@amuse/protocol";
import { forEachLine } from "./lines.ts";

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function readJournalFile(path: string, each: (envelope: Envelope) => void): { bytes: number; sha256: string; events: number; torn: number } {
  let events = 0;
  const file = forEachLine(path, (line) => {
    const parsed = Envelope.safeParse(parseLine(line));
    if (!parsed.success || parsed.data.seq !== events + 1)
      throw new Error(`${path}: line ${events + 1} is not the next event this version can read; move the file aside to start over`);
    events += 1;
    each(parsed.data);
  });
  return { ...file, events };
}
