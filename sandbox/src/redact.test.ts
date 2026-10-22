import assert from "node:assert/strict";
import { test } from "node:test";
import { type SandboxClient, SandboxError } from "./client.ts";
import { mask, masking } from "./redact.ts";

test("credentials are masked by name, the longest first; values too short to be one are left", () => {
  const secrets = [
    { name: "SHORT", value: "abc" },
    { name: "KEY", value: "sk-123456" },
    { name: "LONG", value: "sk-123456-extra" },
  ];
  assert.equal(mask("a sk-123456-extra and sk-123456, abc", secrets), "a ‹LONG› and ‹KEY›, abc");
});

test("what the sandbox brings back, output and errors alike, comes masked", async () => {
  const leaky: SandboxClient = {
    run: async ({ command }) => {
      if (command === "fail") throw new SandboxError("failed", "it said sk-123456");
      return { output: "token=sk-123456\n", cut: 0, exitCode: 0, signal: null, timedOut: false };
    },
    reset: async () => {},
    typeSecret: async () => {},
    setEnv: async () => {},
    setFile: async () => {},
    forget: async () => {},
  };
  const seen = masking(leaky, () => [{ name: "KEY", value: "sk-123456" }]);
  assert.equal((await seen.run({ command: "env" })).output, "token=‹KEY›\n");
  await assert.rejects(seen.run({ command: "fail" }), (e: unknown) => e instanceof SandboxError && e.detail === "it said ‹KEY›");
});
