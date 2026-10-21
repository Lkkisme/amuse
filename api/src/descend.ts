/**
 * Getting to a file in the workspace without being sent elsewhere. The sandbox
 * shares the workspace, and a process there may swap a folder or a file for a
 * symbolic link at any moment, so looking a path up again after checking it
 * proves nothing. Instead each folder is opened from the one before it, by its
 * name and without following a link (O_NOFOLLOW), and everything after is done
 * through that open folder: its entries are named as /proc/self/fd/<fd>/<name>,
 * which the kernel resolves from the folder itself, whatever its own name now
 * leads to. A link anywhere on the way is refused; a link at the end is only
 * ever itself (deleted as a link, never followed). Linux only, as the server's
 * container is.
 */
import { closeSync, constants, lstatSync, openSync } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import { WorkspaceError } from "@amuse/core";

const { O_CREAT, O_DIRECTORY, O_EXCL, O_NOFOLLOW, O_NONBLOCK, O_RDONLY, O_WRONLY } = constants;

/** What is not there. */
export class Missing extends WorkspaceError {}

const codeOf = (error: unknown) => (typeof error === "object" && error !== null && "code" in error ? error.code : undefined);
/** Already gone is as good as deleted. */
const gone = (error: unknown) => {
  if (codeOf(error) !== "ENOENT") throw error;
};
const linked = (path: string) => new WorkspaceError(`"${path}" is not in the workspace`);

/** A folder held open: names in it are looked up from the folder itself. */
export interface Folder {
  /** the folder itself, as a path that reads its entries */
  readonly self: string;
  /** a name in the folder (a single part, never "." or ".."), as a path that goes through the folder itself */
  at(name: string): string;
  close(): Promise<void>;
}

/** A single path part. */
function part(name: string): string {
  if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\u0000"))
    throw new WorkspaceError(`"${name}" is not a name in the workspace`);
  return name;
}

function held(handle: FileHandle): Folder {
  const self = `/proc/self/fd/${handle.fd}`;
  return { self, at: (name) => `${self}/${part(name)}`, close: () => handle.close() };
}

/** The top folder, opened (its own name may be a link: it is the server's, not the sandbox's). */
export async function top(root: string): Promise<Folder> {
  return held(await open(root, O_RDONLY | O_DIRECTORY));
}

/**
 * The folder `name` in `folder`, opened from it without following a link. `shown` is its path as the user knows it, for
 * the words of a refusal. With `make`, it is made if it is not there.
 */
export async function enter(folder: Folder, name: string, shown: string, make = false): Promise<Folder> {
  for (let attempt = 0; ; attempt++) {
    try {
      return held(await open(folder.at(name), O_RDONLY | O_DIRECTORY | O_NOFOLLOW));
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT") {
        if (!make || attempt > 2) throw new Missing(`there is no ${shown}`);
        await mkdir(folder.at(name), { mode: 0o700 }).catch((e: unknown) => {
          if (codeOf(e) !== "EEXIST") throw e;
        });
      } else if (code === "ELOOP" || code === "ENOTDIR") {
        // a link, or something that is not a folder
        const info = await lstat(folder.at(name)).catch(() => null);
        throw info?.isSymbolicLink() ? linked(shown) : new WorkspaceError(`${shown} is not a folder`);
      } else throw error;
    }
  }
}

/** The folder at `parts` below `root`, each opened from the one before; the others are let go. */
export async function walk(root: string, parts: string[], make = false): Promise<Folder> {
  let current = await top(root);
  for (const [i, name] of parts.entries()) {
    const next = await enter(current, name, parts.slice(0, i + 1).join("/"), make).finally(() => void current.close().catch(() => {}));
    current = next;
  }
  return current;
}

/** What is at a name in a folder, without following it. */
export type Kind = "missing" | "link" | "file" | "folder" | "other";

export async function kindOf(folder: Folder, name: string): Promise<Kind> {
  try {
    const info = await lstat(folder.at(name));
    return info.isSymbolicLink() ? "link" : info.isFile() ? "file" : info.isDirectory() ? "folder" : "other";
  } catch (error) {
    if (codeOf(error) === "ENOENT") return "missing";
    throw error;
  }
}

/**
 * A file at a name in a folder, opened (never through a link, and without waiting on a pipe) and checked to be a plain
 * file; closed again otherwise. `flags` as for open(2), O_RDONLY if none.
 */
export async function openFile(folder: Folder, name: string, shown: string, flags = O_RDONLY, mode = 0o600): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(folder.at(name), flags | O_NOFOLLOW | O_NONBLOCK, mode);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT") throw new Missing(`there is no ${shown}`);
    if (code === "ELOOP") throw linked(shown);
    if (code === "EEXIST") throw new WorkspaceError(`${shown} already exists`);
    // a pipe with no one at the other end, or a folder opened to write
    if (code === "ENXIO" || code === "EISDIR") throw new Missing(`there is no file ${shown}`);
    throw error;
  }
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Missing(`there is no file ${shown}`);
  }
  return handle;
}

/** Delete what is at a name in a folder: a link, a file, or a folder and all in it; a link is deleted itself, and never followed. */
export async function remove(folder: Folder, name: string): Promise<void> {
  let inside: Folder;
  try {
    inside = held(await open(folder.at(name), O_RDONLY | O_DIRECTORY | O_NOFOLLOW));
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT") return;
    // not a folder (any longer): a file, or a link that took its place
    if (code !== "ELOOP" && code !== "ENOTDIR") throw error;
    return await unlink(folder.at(name)).catch(gone);
  }
  try {
    for (const child of await readdir(inside.self)) await remove(inside, child);
  } finally {
    await inside.close();
  }
  await rmdir(folder.at(name));
}

/**
 * Copy what is at a name in a folder to a name in another, into files and folders of their own: new inodes, which no
 * process that held the originals open (or linked them elsewhere) has any hold on. Folders are copied with what is in them;
 * a link, a pipe or anything that is not a plain file or folder is left behind, never followed.
 */
export async function copy(from: Folder, name: string, shown: string, to: Folder, target: string): Promise<void> {
  const kind = await kindOf(from, name);
  if (kind === "file") {
    const source = await openFile(from, name, shown);
    try {
      const made = await openFile(to, target, shown, O_WRONLY | O_CREAT | O_EXCL, (await source.stat()).mode & 0o777);
      try {
        const chunk = Buffer.allocUnsafe(1024 ** 2);
        for (let at = 0; ;) {
          const { bytesRead } = await source.read(chunk, 0, chunk.length, at);
          if (bytesRead === 0) break;
          await made.write(chunk, 0, bytesRead, at);
          at += bytesRead;
        }
      } finally {
        await made.close();
      }
    } finally {
      await source.close();
    }
  } else if (kind === "folder") {
    const inside = await enter(from, name, shown);
    try {
      await mkdir(to.at(target), { mode: 0o700 }).catch((error: unknown) => {
        throw codeOf(error) === "EEXIST" ? new WorkspaceError(`${shown} already exists there`) : error;
      });
      const into = await enter(to, target, shown);
      try {
        for (const child of await readdir(inside.self)) await copy(inside, child, `${shown}/${child}`, into, child);
      } finally {
        await into.close();
      }
    } finally {
      await inside.close();
    }
  }
}

/** Whether a plain file is at `parts` below `root` now, found as a walk finds it (no link on the way or at the end), for what must answer at once. */
export function presentSync(root: string, parts: string[]): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(root, O_RDONLY | O_DIRECTORY);
    for (const name of parts.slice(0, -1)) {
      const next = openSync(`/proc/self/fd/${fd}/${part(name)}`, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      closeSync(fd);
      fd = next;
    }
    return lstatSync(`/proc/self/fd/${fd}/${part(parts.at(-1) ?? "")}`).isFile();
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * An error from the walk as words for whoever asked, about `shown` (a path as the user knows it) and never about where it is
 * on this machine. What is already worded is left as it is.
 */
export function worded(shown: string, error: unknown): WorkspaceError {
  if (error instanceof WorkspaceError) return error;
  switch (codeOf(error)) {
    case "ENOENT":
      return new Missing(`there is no ${shown}`);
    case "ELOOP":
      return linked(shown);
    case "ENOTDIR":
      return new WorkspaceError(`${shown} is not a folder, or is in one that is not`);
    case "EISDIR":
      return new WorkspaceError(`${shown} is a folder`);
    case "EEXIST":
      return new WorkspaceError(`${shown} already exists`);
    case "EACCES":
    case "EPERM":
      return new WorkspaceError(`${shown} cannot be used: it is not open to this account`);
    case "ENOTEMPTY":
      return new WorkspaceError(`${shown} could not be deleted: something is still being added to it; try again`);
    case "ENOSPC":
    case "EDQUOT":
      return new WorkspaceError(`there is no room left for ${shown}`);
    case "EXDEV":
      return new WorkspaceError(`${shown} cannot be moved there`);
    case "EBUSY":
      return new WorkspaceError(`${shown} is in use and cannot be changed just now`);
    case "EMFILE":
    case "ENFILE":
      return new WorkspaceError("too many files are open just now; try again");
    default:
      return new WorkspaceError(`${shown} could not be reached just now`);
  }
}
