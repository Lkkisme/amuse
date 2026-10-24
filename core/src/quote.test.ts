import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entity } from "@amuse/protocol";
import { quoteOf, quoted } from "./quote.ts";

const at = "2026-10-20T08:00:00Z";

test("a reply is quoted by its words, flattened and clipped; with only a file, by the file's name", () => {
  const reply = (text: string): Entity => ({ kind: "reply", id: "r1", at, text, streaming: false, attachments: [{ id: "f-1", name: "plan.pdf", type: "application/pdf", size: 10, path: "user/plan.pdf" }] });
  assert.deepEqual(quoteOf(reply("Shall I\n book it?")), { id: "r1", kind: "reply", text: "Shall I book it?", state: null });
  assert.equal(quoteOf(reply(""))?.text, "plan.pdf");
  const long = quoteOf(reply("word ".repeat(200)));
  assert.equal(long?.text.length, 300);
  assert.ok(long?.text.endsWith("…"));
});

test("a card is quoted by its title and state; a running schedule says so", () => {
  const schedule: Entity = { kind: "schedule", id: "s1", at, title: "Morning briefing", instructions: "", when: { kind: "once", at }, status: "active", next: at, running: true, last: null, needs: null, preset: false, goal: null };
  assert.deepEqual(quoteOf(schedule), { id: "s1", kind: "schedule", text: "Morning briefing", state: "running" });
  const approval: Entity = { kind: "approval", id: "a1", at, action: "send email", target: "ann@example.com", detail: "", remember: true, status: "pending", expires: at, app: null, always: false, byRule: false, lasting: false };
  assert.deepEqual(quoteOf(approval), { id: "a1", kind: "approval", text: "send email ann@example.com", state: "pending" });
});

test("the user's own messages and the exchanges between agents are not quotable", () => {
  assert.equal(quoteOf({ kind: "prompt", id: "p1", at, text: "hi", timezone: "UTC", attachments: [], quote: null }), null);
  assert.equal(quoteOf({ kind: "instruction", id: "i1", at, run: "b1", title: "Log in", text: "more" }), null);
});

test("the agent reads a quoted card by its kind, id, title and state, and a quoted message by its words", () => {
  assert.equal(quoted({ id: "r1", kind: "reply", text: "Shall I book it?", state: null }), 'your message "Shall I book it?"');
  assert.equal(quoted({ id: "b1", kind: "browser", text: "Look at the aquarium", state: "working" }), 'your browser task card b1 "Look at the aquarium" (working)');
  assert.equal(quoted({ id: "x1", kind: "failure", text: "", state: "open" }), 'your "could not reply" card x1 (open)');
});
