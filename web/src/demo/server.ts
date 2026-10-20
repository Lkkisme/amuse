/**
 * An in-browser stand-in for the server: implements the protocol's Handlers
 * with scripted behavior and emits events like the real one will. Swapping it
 * for a WebSocket session changes nothing in the UI.
 */
import {
  type Browser,
  type Entity,
  type Envelope,
  type Event,
  type Handlers,
  type State,
  apply,
  dispatch,
  empty,
} from "@remuse/protocol";
import type { Session } from "../session.ts";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function seed(): Entity[] {
  return [
    { kind: "prompt", id: "p1", at: minutesAgo(32), text: "Check the school-trip email and research exhibits at the aquarium" },
    {
      kind: "reply",
      id: "r1",
      at: minutesAgo(31),
      text: "I found the trip email, opened it, and pulled together the exhibit options. Here's the plan I'm following:",
      streaming: false,
    },
    {
      kind: "task",
      id: "t1",
      at: minutesAgo(31),
      title: "Aquarium trip research",
      status: "working",
      steps: [
        { label: "Open the trip email", done: true },
        { label: "List exhibit options", done: true },
        { label: "Check opening hours", done: false },
        { label: "Summarize for the reply", done: false },
      ],
    },
    { kind: "prompt", id: "p2", at: minutesAgo(29), text: "Book the table for Friday" },
    {
      kind: "approval",
      id: "a1",
      at: minutesAgo(29),
      action: "Send email",
      target: "restaurant@example.com",
      detail: "Reserve a table for 4, Friday 7pm. Draft ready for your review.",
      status: "pending",
    },
    {
      kind: "browser",
      id: "b1",
      at: minutesAgo(28),
      title: "Monterey Bay Aquarium exhibits",
      url: "https://mbayaq.org/exhibits",
      status: "completed",
    },
    { kind: "prompt", id: "p3", at: minutesAgo(5), text: "Also check the tide schedule, and log in to the trip portal for me" },
    {
      kind: "browser",
      id: "b2",
      at: minutesAgo(5),
      title: "Check the tide schedule",
      url: "https://tidesandcurrents.noaa.gov/stationhome",
      status: "working",
    },
    {
      kind: "browser",
      id: "b3",
      at: minutesAgo(4),
      title: "Log in to the trip portal",
      url: "https://portal.example.edu/login",
      status: "needs_you",
    },
    {
      kind: "reply",
      id: "r2",
      at: minutesAgo(4),
      text: "The portal is asking for your login. Take control, sign in, then tap **Done** and I'll pick it up from there.",
      streaming: false,
    },
    { kind: "connection", id: "c1", at: minutesAgo(3), provider: "googlesheets", title: "Google Sheets", status: "pending" },
    {
      kind: "reply",
      id: "r3",
      at: minutesAgo(3),
      text: "Connect Google Sheets and I'll put the exhibit list into your trip planner.",
      streaming: false,
    },
  ];
}

export function createDemoSession(): Session {
  let state: State = empty;
  const log: Envelope[] = [];
  const listeners = new Set<(envelope: Envelope) => void>();
  let ids = 0;
  const nextId = (prefix: string) => `${prefix}${++ids}`;
  /** Timers of the reply being streamed, so chat.stop can cut it. */
  let replying: number[] = [];

  const emit = (event: Event) => {
    const envelope = { seq: state.seq + 1, event };
    state = apply(state, envelope);
    log.push(envelope);
    for (const listener of listeners) listener(envelope);
  };
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
  const find = <K extends Entity["kind"]>(kind: K, id: string) =>
    state.entities.find((e): e is Extract<Entity, { kind: K }> => e.kind === kind && e.id === id);
  const update = <K extends Entity["kind"]>(kind: K, id: string, fn: (e: Extract<Entity, { kind: K }>) => Extract<Entity, { kind: K }>) => {
    const entity = find(kind, id);
    if (entity) emit({ kind: "upserted", entity: fn(entity) });
  };
  const setBrowser = (id: string, status: Browser["status"]) => update("browser", id, (b) => ({ ...b, status }));

  /** Stream a reply word by word, with the activity line set while it does. */
  const reply = (text: string, delay = 600) => {
    emit({ kind: "activity", activity: { kind: "responding", label: null } });
    replying.push(
      later(delay, () => {
        const id = nextId("r");
        const [first = "", ...rest] = text.split(" ");
        emit({ kind: "upserted", entity: { kind: "reply", id, at: new Date().toISOString(), text: first, streaming: true } });
        rest.forEach((word, i) => replying.push(later(70 * (i + 1), () => emit({ kind: "appended", id, text: ` ${word}` }))));
        replying.push(
          later(70 * (rest.length + 1), () => {
            update("reply", id, (r) => ({ ...r, streaming: false }));
            emit({ kind: "activity", activity: null });
            replying = [];
          }),
        );
      }),
    );
  };

  for (const entity of seed()) emit({ kind: "upserted", entity });

  const handlers: Handlers = {
    "session.sync": async ({ since }) =>
      since !== null && since <= state.seq && (log[0]?.seq ?? 1) <= since + 1
        ? { kind: "events", events: log.filter((e) => e.seq > since) }
        : { kind: "snapshot", state },
    "chat.send": async ({ text }) => {
      const id = nextId("p");
      emit({ kind: "upserted", entity: { kind: "prompt", id, at: new Date().toISOString(), text } });
      reply(`Got it — **"${text}"**. I'll take that from here and post updates in this chat.`, 1400);
      return { id };
    },
    "chat.stop": async () => {
      replying.forEach(clearTimeout);
      replying = [];
      for (const e of state.entities) if (e.kind === "reply" && e.streaming) update("reply", e.id, (r) => ({ ...r, streaming: false }));
      emit({ kind: "activity", activity: null });
      return null;
    },
    "approval.resolve": async ({ id, resolution }) => {
      const approved = resolution.startsWith("allow");
      update("approval", id, (a) => ({ ...a, status: approved ? "approved" : "denied" }));
      reply(approved ? "Approved — **sending it now**." : "Understood, I dropped the draft.");
      return null;
    },
    "connection.begin": async ({ id }) => {
      // the provider's hosted page would call back; here it just succeeds
      later(800, () => {
        update("connection", id, (c) => ({ ...c, status: "connected" }));
        reply("**Connected.** I can read from it now — want me to pull a sample?");
      });
      return { url: `https://connect.example.com/${id}` };
    },
    "connection.dismiss": async ({ id }) => {
      update("connection", id, (c) => ({ ...c, status: "dismissed" }));
      return null;
    },
    "browser.control": async ({ id, action }) => {
      switch (action) {
        case "take":
          setBrowser(id, "paused");
          break;
        case "handBack":
          setBrowser(id, "working");
          emit({ kind: "activity", activity: { kind: "working", label: "Re-observing page" } });
          later(2500, () => {
            setBrowser(id, "completed");
            emit({ kind: "activity", activity: null });
            reply("Thanks, I have the browser back. The page checks out and the run is **complete**.", 0);
          });
          break;
        case "stop":
          setBrowser(id, "stopped");
          reply("Stopped the browser run where it was. Nothing was submitted.");
          break;
      }
      return null;
    },
    "task.stop": async ({ id }) => {
      update("task", id, (t) => ({ ...t, status: "stopped" }));
      return null;
    },
  };

  return {
    call: (method, params) => dispatch(handlers, { method, params }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
