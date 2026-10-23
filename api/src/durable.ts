/**
 * Files that are never seen half written: the data goes to a temporary file beside the real one, is flushed to the
 * disk, and only then takes its place, so a crash leaves the old file or the whole new one.
 */
import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** Write `data` to a new file `to` (owner-only by `mode`) and flush it. */
function written(to: string, data: string | Uint8Array, mode: number, flags: "w" | "wx" = "w"): void {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const fd = openSync(to, flags, mode);
  try {
    // a write may take less than it was given
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Flush a folder's entries (a new name in it), as far as the system lets. */
function flushed(folder: string): void {
  try {
    const fd = openSync(folder, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // some systems do not let a folder be flushed: the file itself was
  }
}

/** `path` becomes `data`, whole or not at all. */
export function replaceFile(path: string, data: string | Uint8Array, mode = 0o600): void {
  const temporary = `${path}.tmp`;
  written(temporary, data, mode);
  renameSync(temporary, path);
  flushed(dirname(path));
}

/** `path` becomes `data` only if there is no file there: whole, never over another, and false when there was one. */
export function createFile(path: string, data: string | Uint8Array, mode = 0o600): boolean {
  // a name of its own, made only if it is new: nothing left lying there is written into, or followed
  const temporary = `${path}.${randomBytes(6).toString("hex")}.new`;
  written(temporary, data, mode, "wx");
  try {
    // a hard link fails when the name is taken, and a file that appears there is whole at once
    linkSync(temporary, path);
    flushed(dirname(path));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(temporary);
  }
}
