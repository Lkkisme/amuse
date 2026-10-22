import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { staticFiles } from "./static.ts";

const portOf = (address: string | AddressInfo | null) => (typeof address === "object" && address !== null ? address.port : 0);

test("the app's files go compressed when the browser takes it, as they are when not; a missing asset is a 404", async () => {
  const root = mkdtempSync(join(tmpdir(), "amuse-static-"));
  mkdirSync(join(root, "assets"));
  const script = `console.log(${JSON.stringify("x".repeat(50_000))});`;
  writeFileSync(join(root, "assets", "index-abc.js"), script);
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Amuse</title>");
  const server = createServer(staticFiles(root));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const at = `http://127.0.0.1:${portOf(server.address())}`;
  const { request } = await import("node:http");
  /** The raw answer (fetch would undo the compression itself). */
  const get = (path: string, encoding: string) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((done, failed) => {
      request(`${at}${path}`, { headers: { "accept-encoding": encoding } }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (part: Buffer) => parts.push(part));
        res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
      })
        .on("error", failed)
        .end();
    });
  try {
    const br = await get("/assets/index-abc.js", "gzip, deflate, br");
    assert.equal(br.headers["content-encoding"], "br");
    assert.ok(br.body.length < script.length / 10, String(br.body.length));
    assert.equal(brotliDecompressSync(br.body).toString(), script);
    assert.match(String(br.headers["cache-control"]), /immutable/);
    assert.equal(br.headers["vary"], "accept-encoding");

    const gz = await get("/assets/index-abc.js", "gzip");
    assert.equal(gz.headers["content-encoding"], "gzip");
    assert.equal(gunzipSync(gz.body).toString(), script);

    const plain = await get("/assets/index-abc.js", "identity");
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.equal(plain.body.toString(), script);

    // small files are not worth it; the app's page stays fresh
    const page = await get("/some/route", "br");
    assert.equal(page.headers["content-encoding"], undefined);
    assert.equal(page.headers["cache-control"], "no-cache");
    assert.match(page.body.toString(), /<title>Amuse/);

    assert.equal((await get("/assets/index-old.js", "br")).status, 404);
  } finally {
    server.close();
  }
});
