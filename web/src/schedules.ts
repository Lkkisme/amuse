/**
 * Schedules in words, on the user's clock: when one runs ("Every day at
 * 8:00 AM"), when it runs next ("Tomorrow, 8:00 AM"), how its last run went.
 */
import cronstrue from "cronstrue";
import type { RunOutcome, Schedule, When } from "@remuse/protocol";

const here = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Every day at 08:00 AM", "Every hour", "At 09:00 AM, only on Monday"; a zone other than the device's is named. */
export function repeats(when: When): string {
  if (when.kind === "once") return `Once, ${moment(when.at)}`;
  let text: string;
  try {
    text = cronstrue.toString(when.cron, { verbose: false });
  } catch {
    text = when.cron;
  }
  // cronstrue says only the time for a daily pattern
  const daily = when.cron.trim().split(/\s+/).slice(2).every((field) => field === "*");
  if (daily && text.startsWith("At ")) text = `Every day at ${text.slice(3)}`;
  return when.timezone === here() ? text : `${text} (${when.timezone})`;
}

/** An instant on this device's clock: "Today, 8:00 AM", "Tomorrow, 8:00 AM", "Fri, Oct 23, 8:00 AM". */
export function moment(instant: string, now = new Date()): string {
  const date = new Date(instant);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

export const outcomes: Record<RunOutcome, string> = {
  reported: "Reported",
  quiet: "Nothing to report",
  failed: "Failed",
  missed: "Missed",
};

/** The line under a schedule's title: what it is doing or will do next. */
export function scheduleState(schedule: Schedule): string {
  if (schedule.running) return "Running now";
  switch (schedule.status) {
    case "active":
      return schedule.next ? `Next: ${moment(schedule.next)}` : "Active";
    case "paused":
      return "Paused";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
  }
}
