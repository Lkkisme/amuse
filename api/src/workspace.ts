/**
 * Muse's workspace on disk (core's Workspace): a folder of real files. What
 * the user sends is saved under user/ (pictures and videos under
 * user/media_library/) by its own name, made unique; the rest is laid out by
 * Muse. Paths are workspace-relative and checked before any use: no "..",
 * no absolute paths, no way through a symbolic link, so nothing leaves it.
 * The chat's attachments are kept in an index beside the workspace (not in
 * it, out of the agent's reach): id → where the file is now, kept up to date
 * when files move and dropped when they are deleted.
 */
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type Entry,
  type Workspace,
  WorkspaceError,
  newId,
} from "@remuse/core";
import { Attachment } from "@remuse/protocol";
import { z } from "zod";

/** The largest file the server takes. */
export const MAX_FILE = 50 * 1024 ** 2;

const kinds: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  heic: "image/heic",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
/** A file's kind by its name. */
export const typeOf = (name: string) =>
  kinds[extname(name).slice(1).toLowerCase()] ?? "application/octet-stream";

/** Kinds shown in the page itself (an <img> or a <video>); every other file is only downloaded. */
export const shownInline = (type: string) =>
  /^image\/(png|jpeg|gif|webp|avif)$/.test(type) ||
  /^video\/(mp4|webm|quicktime|ogg)$/.test(type);

/** A name the user's device gave, as a file name of its own: no folders, no control characters. */
function cleanName(name: string): string {
  const base = basename(name.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return base === "" || base === "." || base === ".."
    ? "file"
    : base.slice(0, 200);
}

/** A workspace path, made plain ("a/./b/" → "a/b"); refused if it would leave the workspace. */
export function plain(path: string): string {
  const parts = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === ".." || part.includes("\u0000")))
    throw new WorkspaceError(`"${path}" is outside the workspace`);
  return parts.join("/");
}

/** Each sent file, and who sent it: what the user sent stays theirs wherever it is moved. */
const Index = z.record(
  z.string(),
  z.object({ attachment: Attachment, by: z.enum(["user", "muse"]) }),
);
type Sent = z.infer<typeof Index>[string];
const at = (sent: Sent, path: string) => ({
  ...sent,
  attachment: { ...sent.attachment, path },
});
const within = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

export interface FileStore extends Workspace {
  /** Keep an upload in user/ by its name (made unique): its bytes as they come, under the size limit; null when too large. */
  save(
    name: string,
    type: string,
    body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<Attachment | null>;
  /** A sent file, by its id: what it is and where it is on disk now; null when it is gone. */
  find(id: string): { attachment: Attachment; file: string } | null;
}

/** The workspace at `root`; the index of sent files at `index` (outside it). */
export function workspace(root: string, index: string): FileStore {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let sent = existsSync(index)
    ? Index.parse(JSON.parse(readFileSync(index, "utf8")))
    : {};
  const saveIndex = () => {
    const temporary = `${index}.next`;
    writeFileSync(temporary, JSON.stringify(sent), { mode: 0o600 });
    renameSync(temporary, index);
  };

  /** Where a workspace path is on disk, having made sure no symbolic link is on the way. */
  const disk = (path: string): string => {
    const rel = plain(path);
    let at = root;
    for (const part of rel === "" ? [] : rel.split("/")) {
      at = join(at, part);
      if (existsSync(at) && lstatSync(at).isSymbolicLink())
        throw new WorkspaceError(`"${path}" is not in the workspace`);
    }
    return at;
  };
  const missing = (path: string) =>
    new WorkspaceError(`there is no ${plain(path) || "workspace"}`);

  /** `name` in `folder`, or "name (2).ext" and so on if that is taken. */
  const unique = (folder: string, name: string) => {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let n = 1; ; n++) {
      const candidate = `${folder}/${n === 1 ? name : `${stem} (${n})${ext}`}`;
      if (!existsSync(disk(candidate))) return candidate;
    }
  };

  const store: FileStore = {
    find(id) {
      const attachment = sent[id]?.attachment;
      if (!attachment) return null;
      const file = disk(attachment.path);
      return existsSync(file) && lstatSync(file).isFile()
        ? { attachment, file }
        : null;
    },
    async save(name, type, body) {
      const clean = cleanName(name);
      const kind =
        type && type !== "application/octet-stream"
          ? type.slice(0, 255)
          : typeOf(clean);
      const folder = /^(image|video)\//.test(kind)
        ? "user/media_library"
        : "user";
      await mkdir(disk(folder), { recursive: true, mode: 0o700 });
      const partial = join(dirname(index), `upload-${newId("p")}.part`);
      let size = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _, done) {
          size += chunk.length;
          done(size > MAX_FILE ? new Error("too large") : null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.from(body),
          limit,
          createWriteStream(partial, { mode: 0o600 }),
        );
      } catch (error) {
        rmSync(partial, { force: true });
        if (size > MAX_FILE) return null;
        throw error;
      }
      const path = unique(folder, clean);
      renameSync(partial, disk(path));
      const attachment: Attachment = {
        id: newId("f"),
        name: clean,
        type: kind,
        size,
        path,
      };
      sent = { ...sent, [attachment.id]: { attachment, by: "user" } };
      saveIndex();
      return attachment;
    },
    async holds(attachment) {
      const found = store.find(attachment.id);
      return (
        found !== null &&
        found.attachment.name === attachment.name &&
        found.attachment.type === attachment.type &&
        found.attachment.size === attachment.size
      );
    },
    async read(id) {
      const found = store.find(id);
      return found
        ? {
            attachment: found.attachment,
            data: new Uint8Array(await readFile(found.file)),
          }
        : null;
    },
    async list(folder) {
      const at = disk(folder);
      if (!existsSync(at)) throw missing(folder);
      const names = await readdir(at);
      const entries = await Promise.all(
        names.map(async (name): Promise<Entry | null> => {
          const stat = await lstat(join(at, name));
          if (stat.isSymbolicLink()) return null;
          const path = [plain(folder), name].filter(Boolean).join("/");
          return {
            path,
            kind: stat.isDirectory() ? "folder" : "file",
            size: stat.isDirectory() ? 0 : stat.size,
            modified: stat.mtime.toISOString(),
          };
        }),
      );
      return entries
        .filter((e) => e !== null)
        .sort((a, b) =>
          a.kind === b.kind
            ? a.path.localeCompare(b.path)
            : a.kind === "folder"
              ? -1
              : 1,
        );
    },
    async open(path) {
      const at = disk(path);
      if (!existsSync(at) || !lstatSync(at).isFile()) throw missing(path);
      const data = new Uint8Array(await readFile(at));
      return { path: plain(path), type: typeOf(at), size: data.length, data };
    },
    async exists(path) {
      return existsSync(disk(path));
    },
    async write(path, data, overwrite) {
      const rel = plain(path);
      if (rel === "") throw new WorkspaceError("a file needs a name");
      const at = disk(rel);
      if (existsSync(at) && (!overwrite || !lstatSync(at).isFile()))
        throw new WorkspaceError(`${rel} already exists`);
      await mkdir(dirname(at), { recursive: true, mode: 0o700 });
      await writeFile(at, data, { mode: 0o600 });
    },
    async move(from, to) {
      const [a, b] = [plain(from), plain(to)];
      if (a === "" || b === "")
        throw new WorkspaceError("the workspace itself cannot be moved");
      if (b === a || b.startsWith(`${a}/`))
        throw new WorkspaceError(`${a} cannot go inside itself`);
      if (!existsSync(disk(a))) throw missing(a);
      if (existsSync(disk(b))) throw new WorkspaceError(`${b} already exists`);
      await mkdir(dirname(disk(b)), { recursive: true, mode: 0o700 });
      await rename(disk(a), disk(b));
      // the chat's files follow them
      sent = Object.fromEntries(
        Object.entries(sent).map(([id, file]) => [
          id,
          within(file.attachment.path, a)
            ? at(file, b + file.attachment.path.slice(a.length))
            : file,
        ]),
      );
      saveIndex();
    },
    async remove(path) {
      const rel = plain(path);
      if (rel === "")
        throw new WorkspaceError("the workspace itself cannot be deleted");
      if (!existsSync(disk(rel))) throw missing(rel);
      await rm(disk(rel), { recursive: true });
      // a sent file that is gone points at nothing
      sent = Object.fromEntries(
        Object.entries(sent).filter(
          ([, file]) => !within(file.attachment.path, rel),
        ),
      );
      saveIndex();
    },
    async share(path) {
      const { path: rel, type, size } = await store.open(path);
      const attachment: Attachment = {
        id: newId("f"),
        name: basename(rel),
        type,
        size,
        path: rel,
      };
      sent = { ...sent, [attachment.id]: { attachment, by: "muse" } };
      saveIndex();
      return attachment;
    },
    locate: (id) => store.find(id)?.attachment.path ?? null,
  };
  return store;
}
