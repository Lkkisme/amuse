import assert from "node:assert/strict";
import { test } from "node:test";
import { Entity, Prompt } from "./entities.ts";
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

test("a message from before replies has no quote, and a reply keeps the item it quotes", () => {
  const old = { kind: "prompt", id: "p1", at: "2026-10-20T08:00:00Z", text: "hi", timezone: "UTC" };
  assert.equal(Prompt.parse(old).quote, null);
  assert.equal(Entity.parse(old).kind, "prompt");
  const quote = { id: "s1", kind: "schedule", text: "Morning briefing", state: "paused" };
  assert.deepEqual(Prompt.parse({ ...old, quote }).quote, quote);
  assert.equal(Prompt.safeParse({ ...old, quote: { ...quote, kind: "prompt" } }).success, false);
});
