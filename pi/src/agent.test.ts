import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModel, redact } from "./index.ts";

test("model specs split at the first slash; ids may contain more", () => {
  assert.deepEqual(parseModel("openrouter/z-ai/glm-5.3-flash"), { provider: "openrouter", id: "z-ai/glm-5.3-flash" });
  assert.equal(parseModel("glm"), undefined);
  assert.equal(parseModel("/x"), undefined);
  assert.equal(parseModel("p/"), undefined);
});

test("errors lose credentials and credential paths", () => {
  const text = redact("401 from https://x with Bearer abcdefghijklmnop, key in /home/u/auth.json: sk-or-v1-0123456789abcdefABCDEF", ["/home/u/auth.json"]);
  assert.doesNotMatch(text, /abcdefghijklmnop|auth\.json|sk-or-v1/);
  assert.match(text, /<redacted>/);
  assert.equal(redact(""), "The model run failed");
});
