import assert from "node:assert/strict";
import { test } from "node:test";
import { type Envelope, type Reply, type State, apply, empty } from "./index.ts";
import { Envelope as EnvelopeSchema, State as StateSchema } from "./index.ts";

const at = "2026-10-20T08:24:00Z";
const reply = (text: string, streaming: boolean): Reply => ({ kind: "reply", id: "r1", at, text, streaming });
const fold = (events: Envelope["event"][]): State =>
  events.reduce((state, event, i) => apply(state, { seq: i + 1, event }), empty);

test("upsert appends new ids in order and replaces existing ones in place", () => {
  const state = fold([
    { kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hi" } },
    { kind: "upserted", entity: reply("", true) },
    { kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hello" } },
  ]);
  assert.deepEqual(
    state.entities.map((e) => e.id),
    ["p1", "r1"],
  );
  assert.equal(state.entities[0]?.kind === "prompt" && state.entities[0].text, "hello");
  assert.equal(state.seq, 3);
});

test("appended text streams into a reply and nothing else", () => {
  const state = fold([
    { kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "hi" } },
    { kind: "upserted", entity: reply("Hel", true) },
    { kind: "appended", id: "r1", text: "lo" },
    { kind: "appended", id: "p1", text: "!" },
  ]);
  assert.deepEqual(state.entities[1], reply("Hello", true));
  assert.equal(state.entities[0]?.kind === "prompt" && state.entities[0].text, "hi");
});

test("activity is replaced, and cleared with null", () => {
  const working = fold([{ kind: "activity", activity: { kind: "working", label: "Re-observing page" } }]);
  assert.deepEqual(working.activity, { kind: "working", label: "Re-observing page" });
  assert.equal(apply(working, { seq: 2, event: { kind: "activity", activity: null } }).activity, null);
});

test("folded state is a valid State, and envelopes round-trip through JSON", () => {
  const events: Envelope["event"][] = [
    { kind: "upserted", entity: reply("ok", false) },
    {
      kind: "upserted",
      entity: {
        kind: "browser",
        id: "b1",
        at,
        title: "Log in to the trip portal",
        url: "https://portal.example.edu/login",
        status: "needs_you",
      },
    },
  ];
  assert.doesNotThrow(() => StateSchema.parse(fold(events)));
  for (const [i, event] of events.entries()) {
    const envelope = { seq: i + 1, event };
    assert.deepEqual(EnvelopeSchema.parse(JSON.parse(JSON.stringify(envelope))), envelope);
  }
});

test("fields outside the schema are dropped at the boundary", () => {
  const browser = { kind: "browser", id: "b1", at, title: "t", url: "https://x.example/", status: "paused", control: "user" };
  const parsed = EnvelopeSchema.parse({ seq: 1, event: { kind: "upserted", entity: browser } });
  assert.ok(parsed.event.kind === "upserted");
  assert.equal("control" in parsed.event.entity, false);
});

test("statuses outside Muse's vocabulary are rejected", () => {
  const browser = { kind: "browser", id: "b1", at, title: "t", url: "https://x.example/", status: "sleeping" };
  assert.equal(EnvelopeSchema.safeParse({ seq: 1, event: { kind: "upserted", entity: browser } }).success, false);
});
