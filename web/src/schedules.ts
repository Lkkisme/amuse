/**
 * Schedules in words, on the user's clock: when one runs ("Every day at
 * 8:00 AM"), when it runs next ("Tomorrow, 8:00 AM"), how its last run went.
 */
import cronstrue from "cronstrue/i18n.js";
import type { RunOutcome, Schedule, When } from "@amuse/protocol";
import { type Language, activeLanguage, catalogOf, localeOf } from "./i18n/language.ts";

const here = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** cronstrue's name for each language's locale */
const CRON_LOCALE: Record<Language, string> = { en: "en", "zh-CN": "zh_CN" };

/** "Every day at 08:00 AM", "Every hour", "At 09:00 AM, only on Monday"; a zone other than the device's is named. */
export function repeats(when: When, language: Language = activeLanguage()): string {
  const t = catalogOf(language);
  if (when.kind === "once") return t.schedule.once(moment(when.at, new Date(), language));
  let text: string;
  try {
    text = cronstrue.toString(when.cron, { verbose: false, locale: CRON_LOCALE[language] });
  } catch {
    text = when.cron;
  }
  // a daily pattern (a set hour and minute, every day) says its time only
  // ("30 * * * *" is hourly, not daily)
  const [minute = "", hour = "", ...rest] = when.cron.trim().split(/\s+/);
  const daily = /^\d+$/.test(minute) && /^\d+$/.test(hour) && rest.every((field) => field === "*");
  if (daily) text = t.schedule.everyDayAt(timeOfDay(Number(hour), Number(minute), language));
  // Chinese puts a full-width comma between the parts cronstrue joins
  if (language === "zh-CN") text = text.replace(/, /g, "，");
  return when.timezone === here() ? text : `${text} (${when.timezone})`;
}

/** A time of day, as the language writes it: "03:00 AM", "03:00". */
function timeOfDay(hour: number, minute: number, language: Language): string {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(localeOf(language), { hour: "2-digit", minute: "2-digit" });
}

/** An instant on this device's clock: "Today, 8:00 AM", "Tomorrow, 8:00 AM", "Fri, Oct 23, 8:00 AM". */
export function moment(instant: string, now = new Date(), language: Language = activeLanguage()): string {
  const t = catalogOf(language);
  const date = new Date(instant);
  const time = date.toLocaleTimeString(localeOf(language), { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  if (days === 0) return t.time.today(time);
  if (days === 1) return t.time.tomorrow(time);
  if (days === -1) return t.time.yesterday(time);
  const dayName = date.toLocaleDateString(localeOf(language), { weekday: "short", month: "short", day: "numeric" });
  return t.time.onDay(dayName, time);
}

/** How a run went, in words. */
export function outcomeLabel(outcome: RunOutcome, language: Language = activeLanguage()): string {
  return catalogOf(language).schedule.outcomes[outcome];
}

/** The line under a schedule's title: what it is doing or will do next. */
export function scheduleState(schedule: Schedule, language: Language = activeLanguage()): string {
  const t = catalogOf(language).schedule.state;
  if (schedule.running) return t.running;
  switch (schedule.status) {
    case "active":
      return schedule.next ? t.next(moment(schedule.next, new Date(), language)) : t.active;
    case "paused":
      return t.paused;
    case "done":
      return t.done;
    case "cancelled":
      return t.cancelled;
  }
}
