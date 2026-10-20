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

test("the read-only credential store parses Pi auth files and refuses writes", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { readOnlyCredentials } = await import("./credentials.ts");
  const dir = mkdtempSync(join(tmpdir(), "remuse-auth-"));
  const good = join(dir, "auth.json");
  writeFileSync(good, JSON.stringify({ openrouter: { type: "api_key", key: "sk-test" } }));
  const store = readOnlyCredentials(good);
  assert.deepEqual(await store.read("openrouter"), { type: "api_key", key: "sk-test" });
  assert.deepEqual(await store.list(), [{ providerId: "openrouter", type: "api_key" }]);
  await assert.rejects(store.delete("openrouter"), /read-only/);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ x: { type: "password", value: "secret-value" } }));
  await assert.rejects(readOnlyCredentials(bad).read("x"), (e: Error) => !e.message.includes("secret-value"));
});
