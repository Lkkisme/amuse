import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SecretDestination, SecretRequest } from "@amuse/protocol";
import type { SandboxClient } from "@amuse/sandbox";
import { sandboxSecrets } from "./secrets.ts";

/** A sandbox that remembers what it was given. */
function fake() {
  const done: string[] = [];
  const sandbox: SandboxClient = {
    run: async () => ({ output: "", cut: 0, exitCode: 0, signal: null, timedOut: false }),
    start: async () => ({ service: { id: "s1", name: "x", command: "x", cwd: "/", startedAt: "", running: true, exitCode: null, signal: null }, output: "" }),
    services: async () => [],
    log: async () => ({
      service: { id: "s1", name: "x", command: "x", cwd: "/", startedAt: "", running: true, exitCode: null, signal: null },
      output: "",
      cut: 0,
    }),
    stop: async () => ({ id: "s1", name: "x", command: "x", cwd: "/", startedAt: "", running: false, exitCode: 0, signal: null }),
    reset: async () => {},
    input: async (service, text) => void done.push(`input ${service} ${text}`),
    setEnv: async ({ name, value }) => void done.push(`env ${name}=${value}`),
    setFile: async ({ path, value }) => void done.push(`file ${path}=${value}`),
    forget: async (what) => void done.push(`forget ${"env" in what ? what.env : what.file}`),
  };
  return { sandbox, done };
}

const request = (id: string, name: string, deliver: SecretDestination): SecretRequest => ({
  kind: "secret",
  id,
  at: "",
  name,
  why: "",
  deliver,
  status: "pending",
});

test("credentials go where asked, are listed without values, masked, taken back, and given again after a reset", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "amuse-secrets-")), "sandbox-secrets.json");
  const { sandbox, done } = fake();
  const secrets = sandboxSecrets(path, sandbox, () => "2026-10-21T00:00:00Z");

  await secrets.give(request("k1", "OpenAI API key", { kind: "env", name: "OPENAI_API_KEY" }), "sk-openai-123");
  await secrets.give(request("k2", "Tool config", { kind: "file", path: ".config/tool/key" }), "file-value-1");
  await secrets.give(request("k3", "Login code", { kind: "stdin", service: "login" }), "code-4567");
  assert.deepEqual(done, ["env OPENAI_API_KEY=sk-openai-123", "file .config/tool/key=file-value-1", "input login code-4567"]);
  assert.equal(statSync(path).mode & 0o777, 0o600);

  const listed = await secrets.secrets();
  assert.deepEqual(
    listed.map((s) => [s.id, s.name]),
    [
      ["k1", "OpenAI API key"],
      ["k2", "Tool config"],
      ["k3", "Login code"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(listed), /sk-openai|file-value|code-4567/, "never the values");
  assert.deepEqual(secrets.masked(), [
    { name: "OPENAI_API_KEY", value: "sk-openai-123" },
    { name: "Tool config", value: "file-value-1" },
    { name: "Login code", value: "code-4567" },
  ]);

  // a new one for the same variable replaces the old
  await secrets.give(request("k4", "OpenAI API key", { kind: "env", name: "OPENAI_API_KEY" }), "sk-openai-999");
  assert.deepEqual(
    (await secrets.secrets()).map((s) => s.id),
    ["k2", "k3", "k4"],
  );

  done.length = 0;
  await secrets.again();
  assert.deepEqual(done, ["file .config/tool/key=file-value-1", "env OPENAI_API_KEY=sk-openai-999"], "a typed code is not typed again");

  done.length = 0;
  await secrets.forget("k4");
  assert.deepEqual(done, ["forget OPENAI_API_KEY"]);
  assert.doesNotMatch(readFileSync(path, "utf8"), /sk-openai/);
  await assert.rejects(secrets.forget("k4"), /not there/);
});
