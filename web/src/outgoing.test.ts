import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entity } from "@amuse/protocol";
import { type Outgoing, outgoingIn } from "./outgoing.ts";

const prompt = (id: string, text: string): Entity => ({
  kind: "prompt",
  id,
  at: "2026-10-21T10:00:00Z",
  text,
  timezone: "UTC",
  attachments: [],
});
const reply = (id: string): Entity => ({
  kind: "reply",
  id,
  at: "2026-10-21T10:00:00Z",
  text: "ok",
  streaming: false,
  attachments: [],
});
const going = (
  key: string,
  text: string,
  after: string | null,
  sent: string | null = null,
): Outgoing => ({
  key,
  chat: "main",
  text,
  attachments: [],
  at: "2026-10-21T10:01:00Z",
  timezone: "UTC",
  sent,
  after,
});

test("a message shows as sending until the server has it, then the server's keeps its place", () => {
  const before = [prompt("p1", "ok"), reply("r1")];
  const one = going("k1", "ok", "r1");
  assert.deepEqual(
    outgoingIn(before, [one], "main").sending.map((p) => [p.id, p.text]),
    [["k1", "ok"]],
    "an earlier message with the same words is not it",
  );
  assert.deepEqual(
    outgoingIn(before, [one], "side").sending,
    [],
    "only in its own chat",
  );

  // the server's message arrives before its answer: found by its words, after where it was sent
  const after = [...before, prompt("p2", "ok")];
  const found = outgoingIn(after, [one], "main");
  assert.deepEqual(found.sending, []);
  assert.equal(found.keys.get("p2"), "k1");
  // and by its id once the answer came
  assert.equal(
    outgoingIn(after, [{ ...one, sent: "p2" }], "main").keys.get("p2"),
    "k1",
  );
});

test("two of the same words sent one after the other are two messages", () => {
  const both = [going("k1", "hi", null), going("k2", "hi", null)];
  const one = outgoingIn([prompt("p1", "hi")], both, "main");
  assert.equal(one.keys.get("p1"), "k1");
  assert.deepEqual(
    one.sending.map((p) => p.id),
    ["k2"],
  );
});
