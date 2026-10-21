/**
 * Server → client: an ordered stream of events. State is a left fold of the
 * stream with `apply`; the client, the server core and test fakes all use
 * this one function, so they cannot disagree about what an event means.
 *
 * A client need not hold the whole feed, only its recent end (`recent`):
 * the feed only grows at the end, so every entity keeps the index it first
 * appeared at, and an upsert says which index it is about. Older entities
 * are fetched a page at a time (session.history) and `prepend`ed.
 */
import { z } from "zod";
import { Activity, Entity, Id } from "./entities.ts";

/** A place in the feed, from 0; an entity keeps its place for good. */
export const Index = z.int().nonnegative();

export const Event = z.discriminatedUnion("kind", [
  /** Insert or replace by id; `index` is the entity's place in the feed (a new id: the end). */
  z.object({ kind: z.literal("upserted"), index: Index, entity: Entity }),
  /** Streamed text for a reply; avoids resending the whole reply per token. */
  z.object({ kind: z.literal("appended"), id: Id, text: z.string() }),
  z.object({ kind: z.literal("activity"), activity: Activity.nullable() }),
]);

/** A position in the stream: 0 before any event; events are numbered from 1, without gaps. */
export const Seq = z.int().nonnegative();

export const Envelope = z.object({ seq: z.int().positive(), event: Event });

export const State = z.object({
  /** seq of the last applied event; 0 for the empty state */
  seq: Seq,
  /** how many entities come before `entities`, not held here; 0 for the whole feed */
  earlier: Index,
  /** the feed from index `earlier` on, in order */
  entities: z.array(Entity),
  activity: Activity.nullable(),
});

/** Older entities for a state that does not hold them all: the feed from index `earlier`, as of `seq`. */
export const Page = z.object({ seq: Seq, earlier: Index, entities: z.array(Entity) });

export type Event = z.infer<typeof Event>;
export type Envelope = z.infer<typeof Envelope>;
export type State = z.infer<typeof State>;
export type Page = z.infer<typeof Page>;

export const empty: State = { seq: 0, earlier: 0, entities: [], activity: null };

export function apply(state: State, { seq, event }: Envelope): State {
  return { ...reduce(state, event), seq };
}

function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case "upserted": {
      const { entity } = event;
      const existing = state.entities.find((e) => e.id === entity.id);
      if (existing) {
        if (existing.kind !== entity.kind) return state; // an id names one entity, of one kind, for good
        return { ...state, entities: state.entities.map((e) => (e.id === entity.id ? entity : e)) };
      }
      if (event.index < state.earlier) return state; // an older entity this state does not hold
      return { ...state, entities: [...state.entities, entity] };
    }
    case "appended":
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.kind === "reply" && e.id === event.id ? { ...e, text: e.text + event.text } : e,
        ),
      };
    case "activity":
      return { ...state, activity: event.activity };
  }
}

/** Still in play: a reply streaming, a run or task not ended, an approval not decided, a schedule's run under way, a question not answered. */
export function unsettled(entity: Entity): boolean {
  switch (entity.kind) {
    case "reply":
      return entity.streaming;
    case "browser":
    case "task":
      return !["completed", "failed", "stopped"].includes(entity.status);
    case "approval":
      return entity.status === "pending";
    case "schedule":
      return entity.running;
    case "question":
      return entity.status === "open";
    case "instruction":
    case "failure":
      return false;
    case "prompt":
    case "connection":
      return false;
  }
}

/**
 * The recent end of the feed: its last `size` entities, reaching back to the
 * oldest unsettled one, so what is still in play (a run in the task pill, a
 * pending approval) is always held.
 */
export function recent(state: State, size: number): State {
  const oldestLive = state.entities.findIndex(unsettled);
  const start = Math.max(0, Math.min(state.entities.length - size, oldestLive < 0 ? Infinity : oldestLive));
  return { ...state, earlier: state.earlier + start, entities: state.entities.slice(start) };
}

/** `page` put in front of `state`; null when it is not the part just before it at the same seq. */
export function prepend(state: State, page: Page): State | null {
  const fits = page.seq === state.seq && page.earlier + page.entities.length === state.earlier;
  return fits ? { ...state, earlier: page.earlier, entities: [...page.entities, ...state.entities] } : null;
}
