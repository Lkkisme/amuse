import assert from "node:assert/strict";
import { mkdtempSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHost, type Timers } from "@remuse/core";
import { demoPorts } from "@remuse/demo";
import { Attachment } from "@remuse/protocol";
import { MAX_FILE, workspace } from "./workspace.ts";
import { listen } from "./server.ts";

const never: Timers<number> = { set: () => 0, clear: () => {} };
const token = "test-token";

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), "remuse-files-"));
  const files = workspace(join(dir, "workspace"), join(dir, "sent.json"));
  const server = await listen({ session: createHost({ ...demoPorts(never), files }, { timers: never }), files, token, port: 0, host: "127.0.0.1" });
  const http = `http://127.0.0.1:${server.port}`;
  const upload = (name: string, type: string, body: BodyInit, auth = true) =>
    fetch(`${http}/files`, { method: "POST", headers: { "content-type": type, "x-file-name": encodeURIComponent(name), ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body });
  const get = (id: string, headers: Record<string, string> = {}) => fetch(`${http}/files/${id}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
  return { dir, files, server, upload, get };
}

test("a file is uploaded, kept with what it is (mode 600), and served back: images in the page, anything else only downloaded", async () => {
  const { dir, files, server, upload, get } = await serve();
  try {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const sent = await upload("猫.png", "image/png", png);
    assert.equal(sent.status, 201);
    const cat = Attachment.parse(await sent.json());
    assert.deepEqual({ name: cat.name, type: cat.type, size: cat.size, path: cat.path }, { name: "猫.png", type: "image/png", size: 6, path: "user/media_library/猫.png" });
    assert.equal((statSync(join(dir, "workspace", cat.path)).mode & 0o777).toString(8), "600");
    // the same name again is kept apart
    const again = Attachment.parse(await (await upload("猫.png", "image/png", png)).json());
    assert.equal(again.path, "user/media_library/猫 (2).png");
    // a name is only a name
    const sneaky = Attachment.parse(await (await upload("../../sent.json", "text/plain", "x")).json());
    assert.equal(sneaky.path, "user/sent.json");
    assert.ok(await files.holds(cat));
    assert.ok(!(await files.holds({ ...cat, size: 7 })), "as uploaded, or not at all");

    const shown = await get(cat.id);
    assert.equal(shown.headers.get("content-type"), "image/png");
    assert.match(shown.headers.get("content-disposition") ?? "", /^inline/);
    assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
    assert.match(shown.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.deepEqual(new Uint8Array(await shown.arrayBuffer()), png);

    // a page could run scripts on this origin: it is only ever downloaded
    const page = Attachment.parse(await (await upload("x.html", "text/html", "<script>alert(1)</script>")).json());
    const html = await get(page.id);
    assert.equal(html.headers.get("content-type"), "application/octet-stream");
    assert.match(html.headers.get("content-disposition") ?? "", /^attachment/);

    // a video seeks by ranges
    const part = await get(cat.id, { range: "bytes=2-3" });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 2-3/6");
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), png.subarray(2, 4));
  } finally {
    await server.close();
  }
});

test("no upload without the token, none over the limit, and no file by a made-up name", async () => {
  const { upload, get, server } = await serve();
  try {
    assert.equal((await upload("a.txt", "text/plain", "hi", false)).status, 401);
    assert.equal((await upload("big.bin", "application/octet-stream", new Uint8Array(MAX_FILE + 1))).status, 413);
    assert.equal((await get("..%2Fsent.json")).status, 404);
    assert.equal((await get("f-00000000-0000-0000-0000-000000000000")).status, 404);
  } finally {
    await server.close();
  }
});

test("the workspace stays inside itself, and the chat's files follow them when they move, and are gone when deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remuse-ws-"));
  const files = workspace(join(dir, "workspace"), join(dir, "sent.json"));
  await files.write("notes/today.md", new TextEncoder().encode("# hi"), false);
  await assert.rejects(files.write("notes/today.md", new Uint8Array(), false), /already exists/);
  await assert.rejects(files.open("../sent.json"), /outside the workspace/);
  // a path from the top is the workspace's top, not the machine's
  await files.write("/etc/passwd", new TextEncoder().encode("mine"), false);
  assert.ok(await files.exists("etc/passwd"));
  await files.remove("etc");
  symlinkSync("/etc", join(dir, "workspace", "outside"));
  await assert.rejects(files.open("outside/hostname"), /not in the workspace/);
  await assert.rejects(files.write("outside/x", new Uint8Array(), false), /not in the workspace/);
  assert.deepEqual((await files.list("")).map((e) => `${e.kind} ${e.path}`), ["folder notes"], "a link is not listed");

  const shared = await files.share("notes/today.md");
  assert.deepEqual({ name: shared.name, type: shared.type, size: shared.size }, { name: "today.md", type: "text/markdown", size: 4 });
  await files.move("notes", "archive/notes");
  assert.equal(files.find(shared.id)?.attachment.path, "archive/notes/today.md");
  assert.equal(new TextDecoder().decode((await files.read(shared.id))?.data), "# hi");
  assert.deepEqual(await files.sentByUser("archive"), [], "Muse's own files are Muse's");
  const theirs = await files.save("bill.png", "image/png", [new Uint8Array([1, 2])]);
  await files.move("user/media_library/bill.png", "archive/bill.png");
  assert.deepEqual(await files.sentByUser("archive"), ["archive/bill.png"], "what the user sent stays theirs where it is moved");
  assert.ok(theirs);
  await files.remove("archive");
  assert.equal(files.find(shared.id), null);
  assert.equal(await files.read(shared.id), null);
});
