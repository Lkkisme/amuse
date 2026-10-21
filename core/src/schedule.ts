/**
 * Time for schedules and approvals, as pure functions of instants: when a
 * schedule runs next, whether a schedule the agent asks for is sound, and
 * the limits that keep a mistaken one from running away.
 */
import type { Schedule, State, When } from "@amuse/protocol";
import { Cron } from "croner";

/** Most schedules active or paused at once. */
export const MAX_SCHEDULES = 20;
/** Fewest minutes between two runs of a schedule. */
export const MIN_INTERVAL_MINUTES = 15;
/** How late a run may still start (amuse was not running at its time); later, it is missed. */
export const GRACE_MS = 2 * 60 * 60_000;
/** How long an approval waits for an answer before it times out (as a no). */
export const APPROVAL_TTL_MS = 30 * 60_000;

const MINUTE = 60_000;

export const later = (instant: string, ms: number) => new Date(Date.parse(instant) + ms).toISOString();

/** Whether `zone` is an IANA time zone this runtime knows. */
export function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const cron = (pattern: string, timezone: string) => new Cron(pattern, { timezone, paused: true });

/** The first run strictly after `after`; null when there is none (a one-off already past). */
export function nextRun(when: When, after: string): string | null {
  if (when.kind === "once") return Date.parse(when.at) > Date.parse(after) ? when.at : null;
  return cron(when.cron, when.timezone).nextRun(new Date(after))?.toISOString() ?? null;
}

/** The instant of a wall-clock time ("2026-10-21 08:00") in `timezone`. */
export function wallClock(local: string, timezone: string): string | null {
  const match = local.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
  if (!match || !knownZone(timezone)) return null;
  try {
    return cron(`${match[1]}T${match[2]}:00`, timezone).nextRun(new Date(0))?.toISOString() ?? null;
  } catch {
    return null;
  }
}

/** Why `when` cannot be a schedule now, or null when it can; for repeats, also its next runs to show. */
export function check(when: When, now: string): { ok: true; next: string; upcoming: string[] } | { ok: false; reason: string } {
  if (when.kind === "once") {
    if (Date.parse(when.at) <= Date.parse(now)) return { ok: false, reason: "that time has passed" };
    if (Date.parse(when.at) - Date.parse(now) > 366 * 24 * 60 * MINUTE) return { ok: false, reason: "that is more than a year away" };
    return { ok: true, next: when.at, upcoming: [when.at] };
  }
  if (!knownZone(when.timezone)) return { ok: false, reason: `"${when.timezone}" is not a time zone` };
  if (when.cron.trim().split(/\s+/).length !== 5) return { ok: false, reason: "a cron pattern has exactly five fields: minute hour day-of-month month day-of-week" };
  let runs: Date[];
  try {
    runs = cron(when.cron, when.timezone).nextRuns(12, new Date(now));
  } catch (error) {
    return { ok: false, reason: `"${when.cron}" is not a cron pattern (${error instanceof Error ? error.message : String(error)})` };
  }
  const [first] = runs;
  if (!first) return { ok: false, reason: `"${when.cron}" never runs` };
  for (let i = 1; i < runs.length; i++) {
    const gap = (runs[i]?.getTime() ?? Infinity) - (runs[i - 1]?.getTime() ?? 0);
    if (gap < MIN_INTERVAL_MINUTES * MINUTE) return { ok: false, reason: `it would run more often than every ${MIN_INTERVAL_MINUTES} minutes` };
  }
  return { ok: true, next: first.toISOString(), upcoming: runs.slice(0, 3).map((d) => d.toISOString()) };
}

/** The schedules that count against the limit: those not done or cancelled. */
export const standing = (state: State): Schedule[] =>
  state.entities.filter((e): e is Schedule => e.kind === "schedule" && (e.status === "active" || e.status === "paused"));

/** The user's time zone: their device's when they last wrote (UTC before they ever have). */
export function userZone(state: State): string {
  return state.entities.findLast((e) => e.kind === "prompt")?.timezone ?? "UTC";
}

/** An instant as the user's wall clock: "2026-10-21 08:00". */
/** Now as the agent is told it: the weekday, the user's local time, and their zone ("Wednesday 2026-10-21 00:30 (America/Los_Angeles)"). */
export function nowIn(instant: string, timezone: string): string {
  const zone = knownZone(timezone) ? timezone : "UTC";
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(new Date(instant));
  return `${weekday} ${localTime(instant, zone)} (${zone})`;
}

export function localTime(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: knownZone(timezone) ? timezone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** The earliest instant something is due: a schedule's run, an approval's or a question's timeout. */
export function deadline(state: State): string | null {
  let soonest: string | null = null;
  for (const e of state.entities) {
    const due =
      e.kind === "schedule" && e.status === "active" && !e.running
        ? e.next
        : (e.kind === "approval" && e.status === "pending") || (e.kind === "question" && e.status === "open")
          ? e.expires
          : null;
    if (due !== null && (soonest === null || Date.parse(due) < Date.parse(soonest))) soonest = due;
  }
  return soonest;
}
