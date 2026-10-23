import assert from "node:assert/strict";
import { test } from "node:test";
import { SecretAsk } from "./secrets.ts";

test("a request from before long-term secrets still reads: a terminal is a temporary code, a variable or file a stored key", () => {
  assert.deepEqual(SecretAsk.parse({ kind: "stdin", service: "login" }), { kind: "temporary", pane: "login" });
  assert.deepEqual(SecretAsk.parse({ kind: "stdin", pane: "w1:p2" }), { kind: "temporary", pane: "w1:p2" });
  assert.deepEqual(SecretAsk.parse({ kind: "env", name: "API_KEY" }), {
    kind: "stored",
    plain: [],
    secret: [{ name: "key", kind: "text", role: null }],
    note: "",
    uses: [{ kind: "env", field: "key", name: "API_KEY" }],
  });
  assert.deepEqual(SecretAsk.parse({ kind: "file", path: ".config/tool/key" }).kind, "stored");
  assert.equal(SecretAsk.safeParse({ kind: "stdin" }).success, false);
});
