import assert from "node:assert/strict";
import { test } from "node:test";
import { type Workspace, noWorkspace } from "@amuse/core";
import { maskingFiles } from "./masked-files.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

/** A workspace of two files: what `env > ~/workspace/x` left, and a picture. */
function files(): Workspace {
  const picture = Uint8Array.from([137, 80, 78, 71, 255, 254, 0, 1]);
  const listing = encode("HOME=/home/amuse\nSTRIPE=sk-fake-stripe-0123456789\n");
  return {
    ...noWorkspace,
    open: async (path) => (path === "x" ? { path, type: "text/plain", size: listing.length, data: listing } : { path, type: "image/png", size: picture.length, data: picture }),
    read: async (id) => ({ attachment: { id, name: "x", type: "text/plain", size: listing.length, path: "x" }, data: listing }),
  };
}

test("what the agent reads of a file comes back with the secrets in the sandbox masked, and the file itself is as it was", async () => {
  const secrets = [{ name: "Stripe", value: "sk-fake-stripe-0123456789" }];
  const seen = maskingFiles(files(), () => secrets);
  const opened = await seen.open("x");
  assert.equal(decode(opened.data), "HOME=/home/amuse\nSTRIPE=[secret: Stripe]\n");
  assert.equal(opened.size, opened.data.length);
  assert.equal(decode((await seen.read("a1"))?.data ?? new Uint8Array()), "HOME=/home/amuse\nSTRIPE=[secret: Stripe]\n");
  // not text: as it is
  assert.deepEqual((await seen.open("picture.png")).data, Uint8Array.from([137, 80, 78, 71, 255, 254, 0, 1]));
  // the workspace itself, the user's view, is untouched
  assert.match(decode((await files().open("x")).data), /sk-fake-stripe/);
});

test("with nothing in the sandbox to mask a file is passed on as it is; when masking cannot be done the read fails, not leaks", async () => {
  const plain = maskingFiles(files(), () => []);
  assert.match(decode((await plain.open("x")).data), /sk-fake-stripe/);
  const failing = maskingFiles(files(), () => {
    throw new Error("withheld");
  });
  await assert.rejects(failing.open("x"), /withheld/);
});
