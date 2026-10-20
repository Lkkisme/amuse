/**
 * Server → client: an ordered stream of events. State is a left fold of the
 * stream with `apply`; the client, the server core and test fakes all use
 * this one function, so they cannot disagree about what an event means.
 */
import { z } from "zod";
import { Activity, Entity, Id } from "./entities.ts";

export const Event = z.discriminatedUnion("kind", [
  /** Insert or replace by id. A new id goes to the end of the feed. */
  z.object({ kind: z.literal("upserted"), entity: Entity }),
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
  /** feed order */
  entities: z.array(Entity),
  activity: Activity.nullable(),
});

export type Event = z.infer<typeof Event>;
export type Envelope = z.infer<typeof Envelope>;
export type State = z.infer<typeof State>;

export const empty: State = { seq: 0, entities: [], activity: null };

export function apply(state: State, { seq, event }: Envelope): State {
  return { ...reduce(state, event), seq };
}

function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case "upserted": {
      const { entity } = event;
      const exists = state.entities.some((e) => e.id === entity.id);
      const entities = exists
        ? state.entities.map((e) => (e.id === entity.id ? entity : e))
        : [...state.entities, entity];
      return { ...state, entities };
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
