/**
 * Windows counterpart to Linux's openat-style /proc walk. Every ancestor is
 * held with a no-reparse Win32 handle. The configured workspace and everything
 * below it deny write/delete sharing, so an untrusted workspace process cannot
 * replace a directory or turn it into a junction while a child is used. Private
 * ancestors deny delete sharing but allow the owner to update server metadata;
 * as on Linux, the configured top and its private ancestry are owner-trusted.
 * Files are read/written through the verified CreateFile handle itself, never
 * reopened by path. This intentionally refuses busy paths instead of weakening
 * these checks. It is a filesystem boundary, not a process sandbox.
 */
import { constants, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, parse, resolve } from "node:path";
import { Readable } from "node:stream";
import { WorkspaceError } from "@amuse/core";
import type { Folder, WorkspaceFile } from "./descend.ts";

type Handle = number | bigint;
interface Guard { path: string; handle: Handle; refs: number }
const folders = new WeakMap<Folder, Guard[]>();
const require = createRequire(import.meta.url);
let loaded: ReturnType<typeof api> | undefined;
function api() {
  const koffi = require("koffi") as typeof import("koffi");
  const k = koffi.load("kernel32.dll");
  return {
    open: k.func("__stdcall", "CreateFileW", "intptr_t", ["str16", "uint32_t", "uint32_t", "void *", "uint32_t", "uint32_t", "void *"]),
    close: k.func("__stdcall", "CloseHandle", "int", ["intptr_t"]),
    info: k.func("__stdcall", "GetFileInformationByHandle", "int", ["intptr_t", "void *"]),
    type: k.func("__stdcall", "GetFileType", "uint32_t", ["intptr_t"]),
    error: k.func("__stdcall", "GetLastError", "uint32_t", []),
    seek: k.func("__stdcall", "SetFilePointerEx", "int", ["intptr_t", "int64_t", "void *", "uint32_t"]),
    read: k.func("__stdcall", "ReadFile", "int", ["intptr_t", "void *", "uint32_t", "void *", "void *"]),
    write: k.func("__stdcall", "WriteFile", "int", ["intptr_t", "void *", "uint32_t", "void *", "void *"]),
    end: k.func("__stdcall", "SetEndOfFile", "int", ["intptr_t"]),
  };
}
const win = () => loaded ??= api();
const REPARSE = 0x400;
const DIRECTORY = 0x10;
const noFollow = 0x00200000;
const backup = 0x02000000;

function failure(code = win().error()): Error & { code: string } {
  const name = ({ 2: "ENOENT", 3: "ENOENT", 5: "EACCES", 32: "EBUSY", 33: "EBUSY", 80: "EEXIST", 183: "EEXIST", 145: "ENOTEMPTY", 267: "ENOTDIR" } as Record<number, string>)[code] ?? "EIO";
  return Object.assign(new Error(`Workspace operation failed (${name})`), { code: name, win32Code: code });
}
const linked = (shown: string) => new WorkspaceError(`"${shown}" is not in the workspace`);
function info(handle: Handle) {
  const data = Buffer.alloc(52);
  if (!win().info(handle, data)) throw failure();
  return {
    attributes: data.readUInt32LE(0),
    size: data.readUInt32LE(32) * 2 ** 32 + data.readUInt32LE(36),
    identity: `${data.readUInt32LE(28)}:${data.readUInt32LE(44)}:${data.readUInt32LE(48)}`,
  };
}
function openGuard(path: string, shown: string, privateAncestor = false): Guard {
  const handle = win().open(path, 0x81, privateAncestor ? 3 : 1, null, 3, backup | noFollow, null) as Handle;
  if (handle === -1 || handle === -1n) throw failure();
  try {
    const found = info(handle);
    if (found.attributes & REPARSE) throw linked(shown);
    if (!(found.attributes & DIRECTORY)) throw new WorkspaceError(`${shown} is not a folder`);
    return { path, handle, refs: 0 };
  } catch (error) { win().close(handle); throw error; }
}
function release(guards: Guard[]): void {
  for (const guard of guards) if (--guard.refs === 0) win().close(guard.handle);
}
function folder(guards: Guard[]): Folder {
  for (const guard of guards) guard.refs++;
  let closed = false;
  const self = guards.at(-1)!.path;
  const held: Folder = {
    self,
    at(name) {
      if (closed) throw new WorkspaceError("the workspace folder is closed");
      validName(name);
      return join(self, name);
    },
    close: async () => { if (!closed) { closed = true; release(guards); } },
  };
  folders.set(held, guards);
  return held;
}
/** A single Windows name; ADS, device aliases and normalized trailing dots/spaces are refused. */
function validName(name: string): void {
  if (!name || name === "." || name === ".." || /[\\/:\u0000-\u001f<>"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new WorkspaceError(`"${name}" is not a name in the workspace`);
}
function chain(folder: Folder): Guard[] {
  const held = folders.get(folder);
  if (!held || held.some((g) => g.refs === 0)) throw new WorkspaceError("the workspace folder is closed");
  return held;
}
export function windowsTop(root: string): Folder {
  // The configured top itself is trusted, as on Linux. Resolve it once, then
  // lock every actual ancestor from the volume down before using children.
  const actual = realpathSync(resolve(root));
  const volume = parse(actual).root;
  const names = actual.slice(volume.length).split(/[\\/]/).filter(Boolean);
  const guards: Guard[] = [];
  try {
    let path = volume;
    guards.push(openGuard(path, "workspace", names.length > 0));
    for (const [i, name] of names.entries()) { validName(name); path = join(path, name); guards.push(openGuard(path, "workspace", i < names.length - 1)); }
    return folder(guards);
  } catch (error) { for (const guard of guards) win().close(guard.handle); throw error; }
}
export function windowsEnter(parent: Folder, name: string, shown: string): Folder {
  const guards = chain(parent);
  return folder([...guards, openGuard(parent.at(name), shown)]);
}

export async function windowsOpenFile(parent: Folder, name: string, shown: string, flags: number): Promise<WorkspaceFile> {
  const guards = chain(parent);
  const writable = Boolean(flags & (constants.O_WRONLY | constants.O_RDWR));
  const access = writable ? 0x40000000 | 0x80000000 : 0x80000000;
  const create = flags & constants.O_EXCL ? 1 : flags & constants.O_CREAT ? 4 : 3;
  // Other writers may already hold a source file (copying into protected
  // folders must still work); replacing it is blocked. All I/O below uses
  // this very handle, so even a reparse mutation cannot redirect that I/O.
  const handle = win().open(parent.at(name), access >>> 0, 3, null, create, backup | noFollow, null) as Handle;
  if (handle === -1 || handle === -1n) throw failure();
  let found: ReturnType<typeof info>;
  try {
    found = info(handle);
    if (found.attributes & REPARSE) throw linked(shown);
    if (found.attributes & DIRECTORY || win().type(handle) !== 1) throw Object.assign(new Error(`there is no file ${shown}`), { code: "EISDIR" });
  } catch (error) { win().close(handle); throw error; }
  let closed = false;
  let cursor = 0;
  const check = () => { if (closed) throw failure(6); };
  const seek = (position: number) => { check(); if (!win().seek(handle, position, null, 0)) throw failure(); };
  const read = (buffer: Uint8Array, offset: number, length: number, position: number | null) => {
    const at = position ?? cursor;
    seek(at);
    const amount = Buffer.alloc(4);
    if (!win().read(handle, buffer.subarray(offset, offset + length), length, amount, null)) throw failure();
    const bytesRead = amount.readUInt32LE(0);
    if (position === null) cursor += bytesRead;
    return { bytesRead, buffer };
  };
  const write = (buffer: Uint8Array, offset: number, length: number, position: number | null) => {
    const at = position ?? cursor;
    seek(at);
    const amount = Buffer.alloc(4);
    if (!win().write(handle, buffer.subarray(offset, offset + length), length, amount, null)) throw failure();
    const bytesWritten = amount.readUInt32LE(0);
    if (position === null) cursor += bytesWritten;
    return { bytesWritten, buffer };
  };
  const close = async () => { if (!closed) { closed = true; win().close(handle); } };
  // This is the handle surface the workspace/HTTP server uses. Native
  // Windows HANDLEs cannot be adopted into Node's private CRT descriptor table.
  const file: WorkspaceFile = {
    close,
    stat: async () => { check(); const current = info(handle); return { size: current.size, mode: found.attributes & 1 ? 0o444 : 0o666, isFile: () => true }; },
    read: async (buffer: Uint8Array, offset: number, length: number, position: number | null) => read(buffer, offset, length, position),
    write: async (buffer: Uint8Array, offset: number, length: number, position: number | null) => write(buffer, offset, length, position),
    readFile: async () => {
      const chunks: Buffer[] = [];
      for (;;) { const chunk = Buffer.alloc(256 * 1024); const { bytesRead } = read(chunk, 0, chunk.length, null); if (!bytesRead) break; chunks.push(chunk.subarray(0, bytesRead)); }
      return Buffer.concat(chunks);
    },
    writeFile: async (value: Uint8Array | string) => { const data = typeof value === "string" ? Buffer.from(value) : value; for (let at = 0; at < data.length;) { const { bytesWritten } = write(data, at, Math.min(256 * 1024, data.length - at), null); if (!bytesWritten) throw failure(); at += bytesWritten; } },
    truncate: async (length = 0) => { seek(length); if (!win().end(handle)) throw failure(); cursor = Math.min(cursor, length); },
    createReadStream: (options: { start?: number; end?: number; autoClose?: boolean } = {}) => {
      let at = options.start ?? cursor;
      const stream = new Readable({
        read(size) {
          try {
            const length = Math.max(0, Math.min(size, (options.end ?? Infinity) - at + 1));
            if (!length) { this.push(null); return; }
            const data = Buffer.alloc(length);
            const { bytesRead } = read(data, 0, length, at);
            at += bytesRead;
            this.push(bytesRead ? data.subarray(0, bytesRead) : null);
          } catch (error) { this.destroy(error as Error); }
        },
        destroy(error, callback) { void (options.autoClose === false ? Promise.resolve() : close()).then(() => callback(error), callback); },
      });
      return stream;
    },
  };
  return file;
}

export function windowsPresentSync(root: string, parts: string[]): boolean {
  let held: Folder | undefined;
  let handle: Handle | undefined;
  try {
    held = windowsTop(root);
    for (const name of parts.slice(0, -1)) { const next = windowsEnter(held, name, name); void held.close(); held = next; }
    handle = win().open(held.at(parts.at(-1) ?? ""), 0x80, 1, null, 3, noFollow, null) as Handle;
    if (handle === -1 || handle === -1n) return false;
    const found = info(handle);
    return !(found.attributes & (REPARSE | DIRECTORY)) && win().type(handle) === 1;
  } catch { return false; }
  finally { if (handle !== undefined && handle !== -1 && handle !== -1n) win().close(handle); void held?.close(); }
}
