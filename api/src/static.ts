/**
 * Serves the built web app from one directory: files by path (never outside
 * the root), anything else falls back to index.html so client routes work.
 * Text goes compressed when the browser takes it (brotli, else gzip): the app's
 * script is a megabyte, and a phone far from home may fetch it over a slow link.
 */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { constants, brotliCompressSync, gzipSync } from "node:zlib";

/** What is worth compressing: text, which shrinks to a third or less. */
const compressible = new Set([".html", ".js", ".css", ".svg", ".json"]);

/** The encoding to send in, of those the request takes. */
function encodingFor(req: IncomingMessage): "br" | "gzip" | null {
  const accepted = String(req.headers["accept-encoding"] ?? "");
  return /\bbr\b/.test(accepted) ? "br" : /\bgzip\b/.test(accepted) ? "gzip" : null;
}

/** A file compressed once and kept (the files do not change while the server runs: a new build is a new server). */
const compressed = new Map<string, Buffer>();
function squeezed(key: string, body: Buffer, encoding: "br" | "gzip"): Buffer {
  const id = `${encoding}:${key}`;
  let out = compressed.get(id);
  if (!out) {
    out = encoding === "br" ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(body, { level: 9 });
    compressed.set(id, out);
  }
  return out;
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".apk": "application/vnd.android.package-archive",
  ".woff2": "font/woff2",
};

export function staticFiles(root: string) {
  const base = normalize(root) + sep;
  const read = async (file: string) => ({ file, body: await readFile(file), type: types[extname(file)] ?? "application/octet-stream" });
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
    const file = normalize(join(base, path));
    const found = file.startsWith(base) ? await read(file).catch(() => null) : null;
    // a missing asset (an old build's, say) is missing: the app's page in its place would only fail as a script
    if (!found && path.startsWith("/assets/")) return void res.writeHead(404, { "cache-control": "no-cache" }).end();
    const { file: served, body, type } = found ?? (await read(join(base, "index.html")));
    // hashed assets never change; the shell must always be fresh
    const cache = found && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    const encoding = compressible.has(extname(served)) && body.length > 1024 ? encodingFor(req) : null;
    const sent = encoding ? squeezed(served, body, encoding) : body;
    res.writeHead(200, {
      "content-type": type,
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      vary: "accept-encoding",
      "content-length": sent.length,
      ...(encoding ? { "content-encoding": encoding } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : sent);
  };
}
