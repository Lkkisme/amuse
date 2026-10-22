import assert from "node:assert/strict";
import { test } from "node:test";
import { SecretDestination } from "./entities.ts";

test("a credential typed into a service, from before terminals were herdr's, still reads: as the pane it names", () => {
  assert.deepEqual(SecretDestination.parse({ kind: "stdin", service: "login" }), { kind: "stdin", pane: "login" });
  assert.deepEqual(SecretDestination.parse({ kind: "stdin", pane: "w1:p2" }), { kind: "stdin", pane: "w1:p2" });
  assert.deepEqual(SecretDestination.parse({ kind: "env", name: "API_KEY" }), { kind: "env", name: "API_KEY" });
  assert.equal(SecretDestination.safeParse({ kind: "stdin" }).success, false);
});
