/**
 * The user's files (attachments) on disk: `<dir>/<id>` holds the bytes and
 * `<dir>/<id>.json` what the file is (name, type, size), both mode 600.
 * Uploads stream to disk under a size limit; ids are the server's own
 * (f-<uuid>), so nothing a client sends ever names a path.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { type Files, newId } from "@remuse/core";
import { Attachment } from "@remuse/protocol";

/** The largest file the server takes. */
export const MAX_FILE = 50 * 1024 ** 2;

const fileId = /^f-[0-9a-f-]{36}$/;

export interface FileStore extends Files {
  /** Keep an upload: its bytes as they come, under the size limit; null when it is too large. */
  save(name: string, type: string, body: AsyncIterable<Uint8Array>): Promise<Attachment | null>;
  /** What a file is, and where its bytes are; null when there is none. */
  find(id: string): { attachment: Attachment; path: string } | null;
}

export function fileStore(dir: string): FileStore {
  const find = (id: string) => {
    if (!fileId.test(id)) return null;
    const meta = join(dir, `${id}.json`);
    if (!existsSync(meta)) return null;
    const parsed = Attachment.safeParse(JSON.parse(readFileSync(meta, "utf8")));
    return parsed.success ? { attachment: parsed.data, path: join(dir, id) } : null;
  };
  return {
    find,
    async save(name, type, body) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const id = newId("f");
      const path = join(dir, id);
      const partial = `${path}.part`;
      let size = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _, done) {
          size += chunk.length;
          done(size > MAX_FILE ? new Error("too large") : null, chunk);
        },
      });
      try {
        await pipeline(Readable.from(body), limit, createWriteStream(partial, { mode: 0o600 }));
      } catch (error) {
        rmSync(partial, { force: true });
        if (size > MAX_FILE) return null;
        throw error;
      }
      const attachment: Attachment = { id, name: name.slice(0, 255) || "file", type: type.slice(0, 255) || "application/octet-stream", size };
      writeFileSync(`${path}.json`, JSON.stringify(attachment), { mode: 0o600 });
      renameSync(partial, path);
      return attachment;
    },
    async holds(attachment) {
      const found = find(attachment.id);
      return found !== null && found.attachment.name === attachment.name && found.attachment.type === attachment.type && found.attachment.size === attachment.size;
    },
    async read(id) {
      const found = find(id);
      return found ? { attachment: found.attachment, data: new Uint8Array(await readFile(found.path)) } : null;
    },
  };
}

/** Kinds shown in the page itself (an <img> or a <video>); every other file is only downloaded. */
export const shownInline = (type: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(type) || /^video\/(mp4|webm|quicktime|ogg)$/.test(type);
