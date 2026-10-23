/**
 * What is running now, as the chat agent reads it every turn: a line each for the browser runs and tasks
 * under way, with what each is doing, what it waits on, and how long ago that changed. It is made afresh
 * each turn and goes in the volatile tail of the request, after the part the provider caches (pi/agent.ts,
 * pi/cache.ts), so the agent answers about a task's progress from the state now, never from what it said
 * earlier.
 */
import { type Browser, type Entity, type State, type Task, unsettled } from "@amuse/protocol";
import { onJob } from "./decide.ts";

/** A run the block shows: Muse's work under way (a browser between jobs, or one the user opened, is not one). */
export function live(entity: Entity): boolean {
  return unsettled(entity) && (entity.kind !== "browser" || onJob(entity));
}

/** How a run stands, in the words the agent reads it in. */
const standing = (run: Browser | Task): string => {
  if (run.status === "paused") return "under the user's control";
  if (run.status === "waiting" || run.status === "needs_you") return "waiting for the user";
  return run.status === "queued" ? "starting" : "running";
};

/** What the run is doing right now: the line the UI shows (a browser's step), or a task's plan. */
const doing = (run: Browser | Task): string => {
  if (run.kind === "browser") return run.step === null ? "" : `, now "${run.step}"`;
  if (run.steps.length === 0) return "";
  return `, ${run.steps.filter((s) => s.done).length} of ${run.steps.length} steps done`;
};

/** How long ago `at` was, in words: "just now", "12 minutes ago", "2 hours ago". */
const ago = (at: string, now: string): string => {
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
};

/** One run as a line: what it is, how it stands, what it is doing, and when that last changed (its own start, where the host has seen no change since it came up). */
const line = (run: Browser | Task, changed: Map<string, string>, now: string): string =>
  `- ${run.kind === "browser" ? "browser task" : "task"} "${run.title}" (${run.id}): ${standing(run)}${doing(run)} (${ago(changed.get(run.id) ?? run.at, now)})`;

/**
 * The runs in play in this chat, a heading and a line each; "" when there is none, so a turn that has
 * nothing to watch reads as it always did. `changed`: when each run last changed, by id (the host's,
 * from the changes it records).
 */
export function liveState(state: State, changed: Map<string, string>, now: string): string {
  const runs = state.entities.filter((e): e is Browser | Task => (e.kind === "browser" || e.kind === "task") && live(e));
  return runs.length === 0 ? "" : ["What is running now:", ...runs.map((run) => line(run, changed, now))].join("\n");
}
