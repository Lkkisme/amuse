import assert from "node:assert/strict";
import { test } from "node:test";
import { type SandboxClient, SandboxError } from "./client.ts";
import type { JobState } from "./protocol.ts";
import { mask, masking } from "./redact.ts";

test("credentials are masked by name, the longest first; values too short to be one are left", () => {
  const secrets = [
    { name: "SHORT", value: "abc" },
    { name: "KEY", value: "sk-123456" },
    { name: "LONG", value: "sk-123456-extra" },
  ];
  assert.equal(mask("a sk-123456-extra and sk-123456, abc", secrets), "a [secret: LONG] and [secret: KEY], abc");
});

test("a credential is masked when a terminal wrapped it over lines or coloured part of it", () => {
  const secrets = [{ name: "OPENAI_API_KEY", value: "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789" }];
  assert.equal(mask("key=sk-proj-abcdefghij\nklmnopqrstuvwxyz\r\n0123456789 done", secrets), "key=[secret: OPENAI_API_KEY] done");
  assert.equal(mask("\x1b[32msk-proj-abcdefghijklm\x1b[0mnopqrstuvwxyz0123456789", secrets), "\x1b[32m[secret: OPENAI_API_KEY]");
  // a value with what patterns read as special is matched as it is
  assert.equal(mask("a.b*c+d?(e) x", [{ name: "ODD", value: "a.b*c+d?(e)" }]), "[secret: ODD] x");
  assert.equal(mask("aXb*c+d?(e) x", [{ name: "ODD", value: "a.b*c+d?(e)" }]), "aXb*c+d?(e) x");
  // a name is put in as it is, whatever it holds
  assert.equal(mask("token-123456", [{ name: "$& and $1", value: "token-123456" }]), "[secret: $& and $1]");
});

test("masking takes time in step with the text, whatever the text or the value is made of", () => {
  // a key of forty lines, and a text built to make a pattern try every way of splitting its line breaks
  const lines = Array.from({ length: 40 }, (_, i) => `line${String(i).padStart(2, "0")}-abcdefghijklmn`);
  const value = lines.join("\n");
  const hostile = `${lines.join("\n\n\n\n").slice(0, -1)}X`.repeat(5);
  const started = performance.now();
  assert.equal(mask(hostile, [{ name: "KEY", value }]), hostile);
  assert.ok(performance.now() - started < 200, String(performance.now() - started));
  // and the key printed as it is, or with its lines wrapped differently, is masked
  assert.equal(mask(`-- ${value} --`, [{ name: "KEY", value }]), "-- [secret: KEY] --");
  assert.equal(mask(lines.join("\r\n"), [{ name: "KEY", value }]), "[secret: KEY]");
});

test("what the sandbox brings back, output and errors alike, comes masked", async () => {
  const job: JobState = { id: "j1", running: false, seconds: 1, output: "token=sk-123456\n", cut: 0, end: { exitCode: 0, signal: null, reason: "finished" } };
  const leaky: SandboxClient = {
    run: async ({ command }) => {
      if (command === "fail") throw new SandboxError("failed", "it said sk-123456");
      return { output: "token=sk-123456\n", cut: 0, exitCode: 0, signal: null, timedOut: false };
    },
    start: async () => job,
    jobOutput: async () => job,
    stopJobs: async () => [job],
    waitJob: async () => job,
    reset: async () => {},
    atRisk: async () => [],
    typeSecret: async () => {},
    setEnv: async () => {},
    setFile: async () => {},
    forget: async () => {},
  };
  const seen = masking(leaky, () => [{ name: "KEY", value: "sk-123456" }]);
  assert.equal((await seen.run({ command: "env" })).output, "token=[secret: KEY]\n");
  assert.equal((await seen.start({ chat: "main", command: "env" })).output, "token=[secret: KEY]\n");
  assert.equal((await seen.waitJob({ chat: "main", id: "j1" })).output, "token=[secret: KEY]\n");
  assert.equal((await seen.stopJobs({ chat: "main" }))[0]?.output, "token=[secret: KEY]\n");
  await assert.rejects(seen.run({ command: "fail" }), (e: unknown) => e instanceof SandboxError && e.detail === "it said [secret: KEY]");
});
