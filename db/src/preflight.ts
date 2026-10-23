/**
 * Before anything opens the data: the folders Amuse needs are there and can be written to. A folder that is
 * missing and should be made is made; one that cannot be (a volume mounted read-only, owned by someone else) is
 * said in words with what to do, rather than failing later in some file operation.
 */
import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Folder, type Hint, StartupError } from "./problem.ts";

export interface Requirement {
  folder: Folder;
  path: string;
  /** Make it when it is missing (a folder of ours); else it must already be there (a mount). */
  create: boolean;
  /** What to tell the owner when it is not right. */
  hint: Hint;
}

export function preflight(requirements: readonly Requirement[]): void {
  for (const { folder, path, create, hint } of requirements) {
    const fail = (trouble: "missing" | "not-a-folder" | "not-writable") => new StartupError({ kind: "folder", folder, path, trouble, hint }, `${path}: ${trouble}`);
    let found = lstatSync(path, { throwIfNoEntry: false });
    if (!found && !create) throw fail("missing");
    if (!found) {
      try {
        mkdirSync(path, { recursive: true, mode: 0o700 });
      } catch {
        throw fail("not-writable");
      }
      found = lstatSync(path);
    }
    if (!found.isDirectory()) throw fail("not-a-folder");
    // a real write, since a read-only mount or another owner says so only when written to
    const probe = join(path, `.amuse-writable-${process.pid}`);
    try {
      writeFileSync(probe, "", { mode: 0o600 });
      rmSync(probe);
    } catch {
      throw fail("not-writable");
    }
  }
}
