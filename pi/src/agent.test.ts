import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModel, pick, redact } from "./index.ts";

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
  const dir = mkdtempSync(join(tmpdir(), "amuse-auth-"));
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

test("an app with several accounts asks which; one is used as is; an account is found by its email", () => {
  const one = [{ id: "ca_1", label: "me@a.com" }];
  const two = [...one, { id: "ca_2", label: "work@b.com" }];
  assert.deepEqual(pick("gmail", one, undefined), { ok: true, account: one[0] });
  const unsure = pick("gmail", two, undefined);
  assert.ok(!unsure.ok && /several accounts: me@a.com, work@b.com/.test(unsure.text));
  assert.deepEqual(pick("gmail", two, "WORK@b.com"), { ok: true, account: two[1] });
  assert.ok(!pick("gmail", two, "x@c.com").ok);
  assert.ok(!pick("gmail", [], undefined).ok);
});

test("the user's language is told by the script they write in, links aside", async () => {
  const { scriptOf } = await import("./agent.ts");
  assert.equal(scriptOf("用浏览器打开 https://example.com/download 下载第一个文件"), "Chinese");
  assert.equal(scriptOf("ダウンロードして"), "Japanese");
  assert.equal(scriptOf("다운로드해 줘"), "Korean");
  assert.equal(scriptOf("open https://例え.jp/ please"), null);
  assert.equal(scriptOf("download the first file"), null);
});
