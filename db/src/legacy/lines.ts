import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

/**
 * A file's lines, one at a time, without holding the file: `each` gets every line that ends in a newline. What
 * comes after the last newline is a torn write (the process died mid-line); it is counted, not read. The file is
 * only read, and its size and SHA-256 are taken on the way.
 */
export function forEachLine(path: string, each: (line: string) => void): { bytes: number; sha256: string; torn: number } {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1 << 16);
  let pending = Buffer.alloc(0);
  let bytes = 0;
  try {
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      const view = chunk.subarray(0, read);
      bytes += read;
      hash.update(view);
      let start = 0;
      for (let end = view.indexOf(0x0a); end !== -1; end = view.indexOf(0x0a, start)) {
        const line = pending.length > 0 ? Buffer.concat([pending, view.subarray(start, end)]) : view.subarray(start, end);
        pending = Buffer.alloc(0);
        each(line.toString("utf8"));
        start = end + 1;
      }
      pending = Buffer.concat([pending, view.subarray(start)]);
    }
  } finally {
    closeSync(fd);
  }
  return { bytes, sha256: hash.digest("hex"), torn: pending.length };
}
