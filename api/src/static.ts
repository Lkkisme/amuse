/**
 * Serves the built web app from one directory: files by path (never outside
 * the root), anything else falls back to index.html so client routes work.
 */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

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
  const read = async (file: string) => ({ body: await readFile(file), type: types[extname(file)] ?? "application/octet-stream" });
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
    const file = normalize(join(base, path));
    const found = file.startsWith(base) ? await read(file).catch(() => null) : null;
    const { body, type } = found ?? (await read(join(base, "index.html")));
    // hashed assets never change; the shell must always be fresh
    const cache = found && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
