import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entity, type Envelope, type Reply, type State, apply, empty, prepend, recent } from "./index.ts";
import { Entity as EntitySchema, Envelope as EnvelopeSchema, State as StateSchema } from "./index.ts";

const at = "2026-10-20T08:24:00Z";
const reply = (text: string, streaming: boolean): Reply => ({ kind: "reply", id: "r1", at, text, streaming, attachments: [], suggestions: [], chosen: null });
const fold = (events: Envelope["event"][]): State =>
  events.reduce((state, event, i) => apply(state, { seq: i + 1, event }), empty);
const prompt = (id: string, text = id): Entity => ({ kind: "prompt", id, at, text, timezone: "UTC", attachments: [], quote: null, suggested: false });

test("upsert appends new ids in order and replaces existing ones in place", () => {
  const state = fold([
    { kind: "upserted", index: 0, entity: { kind: "prompt", id: "p1", at, text: "hi", timezone: "UTC", attachments: [], quote: null, suggested: false } },
    { kind: "upserted", index: 1, entity: reply("", true) },
    { kind: "upserted", index: 0, entity: { kind: "prompt", id: "p1", at, text: "hello", timezone: "UTC", attachments: [], quote: null, suggested: false } },
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
    { kind: "upserted", index: 0, entity: { kind: "prompt", id: "p1", at, text: "hi", timezone: "UTC", attachments: [], quote: null, suggested: false } },
    { kind: "upserted", index: 1, entity: reply("Hel", true) },
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
    { kind: "upserted", index: 0, entity: reply("ok", false) },
    {
      kind: "upserted",
      index: 1,
      entity: {
        kind: "browser",
        id: "b1",
        at,
        title: "Log in to the trip portal",
        url: "https://portal.example.edu/login",
        status: "needs_you",
        instructions: "Log in",
        result: null,
        step: null,
        live: true,
        outcome: null,
        files: [],
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
  const browser = { kind: "browser", id: "b1", at, title: "t", url: "https://x.example/", status: "paused", instructions: "t", result: null, step: null, live: true, control: "user" };
  const parsed = EnvelopeSchema.parse({ seq: 1, event: { kind: "upserted", index: 0, entity: browser } });
  assert.ok(parsed.event.kind === "upserted");
  assert.equal("control" in parsed.event.entity, false);
});

test("statuses outside Amuse's vocabulary are rejected", () => {
  const browser = { kind: "browser", id: "b1", at, title: "t", url: "https://x.example/", status: "sleeping" };
  assert.equal(EnvelopeSchema.safeParse({ seq: 1, event: { kind: "upserted", index: 0, entity: browser } }).success, false);
});

test("an id keeps its kind: an upsert of another kind under it is ignored", () => {
  const state = fold([
    { kind: "upserted", index: 0, entity: { kind: "prompt", id: "x", at, text: "hi", timezone: "UTC", attachments: [], quote: null, suggested: false } },
    { kind: "upserted", index: 1, entity: reply("hijack", false) },
  ]);
  const hijack = apply(state, { seq: 3, event: { kind: "upserted", index: 0, entity: { ...reply("hijack", false), id: "x" } } });
  assert.equal(hijack.entities.find((e) => e.id === "x")?.kind, "prompt");
});

const feed = (n: number): State => fold(Array.from({ length: n }, (_, i) => ({ kind: "upserted", index: i, entity: prompt(`p${i}`) })));

test("the recent end of the feed holds its last entities, and folds on like the whole feed", () => {
  const whole = feed(10);
  const window = recent(whole, 3);
  assert.equal(window.earlier, 7);
  assert.deepEqual(window.entities.map((e) => e.id), ["p7", "p8", "p9"]);
  const next = (s: State, index: number, entity: Entity) => apply(s, { seq: s.seq + 1, event: { kind: "upserted", index, entity } });
  // an older entity changing is not held; one held changes in place; a new one goes on the end
  for (const [index, entity] of [[2, prompt("p2", "edited")], [8, prompt("p8", "edited")], [10, prompt("p10")]] as const) {
    const a = next(whole, index, entity);
    const b = next(window, index, entity);
    assert.deepEqual(b.entities, a.entities.slice(b.earlier));
  }
});

test("the recent end reaches back to whatever is still in play", () => {
  const running: Entity = { kind: "browser", id: "b", at, title: "t", url: "https://x.example/", status: "working", instructions: "t", result: null, step: null, live: true, outcome: null, files: [] };
  const state = apply(feed(10), { seq: 11, event: { kind: "upserted", index: 2, entity: { ...running, id: "p2" } } });
  assert.equal(state.entities[2]?.kind, "prompt"); // an id keeps its kind
  const withRun = fold([
    ...Array.from({ length: 3 }, (_, i): Envelope["event"] => ({ kind: "upserted", index: i, entity: prompt(`p${i}`) })),
    { kind: "upserted", index: 3, entity: running },
    ...Array.from({ length: 6 }, (_, i): Envelope["event"] => ({ kind: "upserted", index: 4 + i, entity: prompt(`q${i}`) })),
  ]);
  assert.equal(recent(withRun, 2).earlier, 3);
  assert.equal(recent(feed(2), 5).earlier, 0);
  // with nothing to let go of (what is in play is first), the very same state: a view that trims on every change must not loop
  const heldFromStart = fold([{ kind: "upserted", index: 0, entity: running }, ...Array.from({ length: 6 }, (_, i): Envelope["event"] => ({ kind: "upserted", index: 1 + i, entity: prompt(`r${i}`) }))]);
  assert.equal(recent(heldFromStart, 2), heldFromStart);
  const short = feed(2);
  assert.equal(recent(short, 5), short);
  // a browser closed between jobs (idle, its browser gone) is a record, and holds nothing back
  const closed = fold([{ kind: "upserted", index: 0, entity: { ...running, status: "idle", live: false } }, ...Array.from({ length: 6 }, (_, i): Envelope["event"] => ({ kind: "upserted", index: 1 + i, entity: prompt(`s${i}`) }))]);
  assert.equal(recent(closed, 2).earlier, 5);
  // one still open, idle between jobs, is in play
  const open = fold([{ kind: "upserted", index: 0, entity: { ...running, status: "idle" } }, ...Array.from({ length: 6 }, (_, i): Envelope["event"] => ({ kind: "upserted", index: 1 + i, entity: prompt(`t${i}`) }))]);
  assert.equal(recent(open, 2).earlier, 0);
});

test("a page goes in front only when it is the part just before, at the same seq", () => {
  const whole = feed(10);
  const window = recent(whole, 3);
  const page = { seq: whole.seq, earlier: 4, entities: whole.entities.slice(4, 7) };
  assert.deepEqual(prepend(window, page), recent(whole, 6));
  assert.equal(prepend(window, { ...page, seq: whole.seq - 1 }), null);
  assert.equal(prepend(window, { ...page, earlier: 3, entities: whole.entities.slice(3, 6) }), null);
});

test("an approval from before rules could refuse one replays as an ordinary one", () => {
  const old = { kind: "approval", id: "a1", at: "2026-10-20T08:00:00Z", action: "Visit", target: "bank.com", detail: "x", remember: true, status: "denied", expires: "2026-10-20T08:30:00Z" };
  const replayed = EntitySchema.parse(old);
  assert.ok(replayed.kind === "approval");
  assert.equal(replayed.byRule, false);
  assert.equal(replayed.always, false);
  assert.equal(replayed.app, null);
  const refused = EntitySchema.parse({ ...old, byRule: true });
  assert.ok(refused.kind === "approval" && refused.byRule);
});
