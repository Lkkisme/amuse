/**
 * Scripted ports and a seeded conversation: what the web demo and dev
 * server run until the real agent, browser pool and connectors are plugged
 * in. Behavior lives here only as port reactions; the rules stay in decide.
 */
import type { Entity } from "@remuse/protocol";
import type { Emit, Ports } from "./host.ts";

/** Scheduling, injectable so tests can run the script without waiting. */
export interface Timers<H> {
  set(ms: number, fn: () => void): H;
  clear(handle: H): void;
}

export const realTimers: Timers<ReturnType<typeof setTimeout>> = {
  set: (ms, fn) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

export function demoPorts<H>(timers: Timers<H>): Ports {
  let replying: H[] = [];
  let ids = 0;
  const later = (ms: number, fn: () => void) => replying.push(timers.set(ms, fn));
  const now = () => new Date().toISOString();

  /** Stream a reply word by word, with the activity line set while it does. */
  const reply = (emit: Emit, text: string, delay = 600) => {
    emit({ kind: "activity", activity: { kind: "responding", label: null } });
    later(delay, () => {
      const id = `r-demo${++ids}`;
      const [first = "", ...rest] = text.split(" ");
      emit({ kind: "upserted", entity: { kind: "reply", id, at: now(), text: first, streaming: true } });
      rest.forEach((word, i) => later(70 * (i + 1), () => emit({ kind: "appended", id, text: ` ${word}` })));
      later(70 * (rest.length + 1), () => {
        emit({ kind: "upserted", entity: { kind: "reply", id, at: now(), text, streaming: false } });
        emit({ kind: "activity", activity: null });
        replying = [];
      });
    });
  };

  return {
    prompt: (text, emit) => reply(emit, `Got it — **"${text}"**. I'll take that from here and post updates in this chat.`, 1400),
    interrupt: () => {
      replying.forEach(timers.clear);
      replying = [];
    },
    browser: ({ browser, action }, emit) => {
      if (action === "handBack") {
        emit({ kind: "activity", activity: { kind: "working", label: "Re-observing page" } });
        timers.set(2500, () => {
          emit({ kind: "activity", activity: null });
          emit({ kind: "upserted", entity: { ...browser, status: "completed" } });
          reply(emit, "Thanks, I have the browser back. The page checks out and the run is **complete**.", 0);
        });
      }
      if (action === "stop") reply(emit, "Stopped the browser run where it was. Nothing was submitted.");
    },
    approval: ({ resolution }, emit) =>
      reply(emit, resolution.startsWith("allow") ? "Approved — **sending it now**." : "Understood, I dropped the draft."),
    stopTask: () => {},
    connect: async (connection, emit) => {
      // the provider's hosted page would call back; here it just succeeds
      timers.set(800, () => {
        emit({ kind: "upserted", entity: { ...connection, status: "connected" } });
        reply(emit, "**Connected.** I can read from it now — want me to pull a sample?");
      });
      return `https://connect.example.com/${connection.id}`;
    },
  };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function seed(): Entity[] {
  return [
    { kind: "prompt", id: "p-seed1", at: minutesAgo(32), text: "Check the school-trip email and research exhibits at the aquarium" },
    {
      kind: "reply",
      id: "r-seed1",
      at: minutesAgo(31),
      text: "I found the trip email, opened it, and pulled together the exhibit options. Here's the plan I'm following:",
      streaming: false,
    },
    {
      kind: "task",
      id: "t-seed1",
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
    { kind: "prompt", id: "p-seed2", at: minutesAgo(29), text: "Book the table for Friday" },
    {
      kind: "approval",
      id: "a-seed1",
      at: minutesAgo(29),
      action: "Send email",
      target: "restaurant@example.com",
      detail: "Reserve a table for 4, Friday 7pm. Draft ready for your review.",
      status: "pending",
    },
    { kind: "browser", id: "b-seed1", at: minutesAgo(28), title: "Monterey Bay Aquarium exhibits", url: "https://mbayaq.org/exhibits", status: "completed" },
    { kind: "prompt", id: "p-seed3", at: minutesAgo(5), text: "Also check the tide schedule, and log in to the trip portal for me" },
    { kind: "browser", id: "b-seed2", at: minutesAgo(5), title: "Check the tide schedule", url: "https://tidesandcurrents.noaa.gov/stationhome", status: "working" },
    { kind: "browser", id: "b-seed3", at: minutesAgo(4), title: "Log in to the trip portal", url: "https://portal.example.edu/login", status: "needs_you" },
    {
      kind: "reply",
      id: "r-seed2",
      at: minutesAgo(4),
      text: "The portal is asking for your login. Take control, sign in, then tap **Done** and I'll pick it up from there.",
      streaming: false,
    },
    { kind: "connection", id: "c-seed1", at: minutesAgo(3), provider: "googlesheets", title: "Google Sheets", status: "pending" },
    {
      kind: "reply",
      id: "r-seed3",
      at: minutesAgo(3),
      text: "Connect Google Sheets and I'll put the exhibit list into your trip planner.",
      streaming: false,
    },
  ];
}
