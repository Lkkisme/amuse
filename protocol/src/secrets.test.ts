import assert from "node:assert/strict";
import { test } from "node:test";
import { FieldValue, MAX_FILE, SecretAnswer, SecretAsk, UseInput, fileSize } from "./secrets.ts";

const base64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

test("a line of text has no line break; a file is at most 64 KB, however its bytes are", () => {
  assert.equal(FieldValue.safeParse({ kind: "text", text: "sk-fake-1234" }).success, true);
  assert.equal(FieldValue.safeParse({ kind: "text", text: "one\ntwo" }).success, false);
  assert.equal(FieldValue.safeParse({ kind: "text", text: "" }).success, false);
  assert.equal(FieldValue.safeParse({ kind: "file", filename: "key.json", content: base64(MAX_FILE) }).success, true);
  assert.equal(FieldValue.safeParse({ kind: "file", filename: "key.json", content: base64(MAX_FILE + 1) }).success, false);
  assert.equal(FieldValue.safeParse({ kind: "file", filename: "key.json", content: "not base64!" }).success, false);
});

test("the size of a file is read off its base64", () => {
  for (const bytes of [1, 2, 3, 4, 100, 1001]) assert.equal(fileSize(base64(bytes)), bytes);
});

test("a use is an environment variable, a file (with a variable for its path, or none) or a service of the server's", () => {
  assert.deepEqual(UseInput.parse({ kind: "file", field: "key.json", path: ".config/gcloud/key.json" }), {
    kind: "file",
    field: "key.json",
    path: ".config/gcloud/key.json",
    env: null,
  });
  assert.equal(UseInput.safeParse({ kind: "env", field: "token", name: "lower" }).success, false);
  assert.equal(UseInput.safeParse({ kind: "server", field: "key", service: "model", target: "openai" }).success, true);
  assert.equal(UseInput.safeParse({ kind: "server", field: "key", service: "browser", target: "x" }).success, false);
});

test("a stored request needs at least one secret field", () => {
  assert.equal(SecretAsk.safeParse({ kind: "stored", plain: [], secret: [], note: "", uses: [] }).success, false);
});

test("an answer to a request card holds secrets only: a typed plain value is refused by the protocol", () => {
  const secret = [{ name: "token", value: { kind: "text" as const, text: "tok-fake-1234567890" } }];
  assert.equal(SecretAnswer.safeParse({ kind: "stored", secret }).success, true);
  assert.equal(SecretAnswer.safeParse({ kind: "stored", plain: [{ name: "username", value: { kind: "text", text: "wyb" } }], secret }).success, false);
  // and a card's plain fields come with their values, from Amuse
  assert.equal(SecretAsk.safeParse({ kind: "stored", plain: [{ name: "username" }], secret: [{ name: "token" }], note: "", uses: [] }).success, false);
  assert.equal(SecretAsk.safeParse({ kind: "stored", plain: [{ name: "username", value: { kind: "text", text: "wyb" } }], secret: [{ name: "token" }], note: "", uses: [] }).success, true);
});
