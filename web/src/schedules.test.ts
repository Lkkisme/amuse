import assert from "node:assert/strict";
import { test } from "node:test";
import type { Schedule } from "@amuse/protocol";
import { cardSubtitle, cardSummary, moment, repeats, standing } from "./schedules.ts";

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

test("a schedule says when it runs: daily at a set hour, or every hour at a minute", () => {
  assert.equal(repeats({ kind: "repeat", cron: "0 3 * * *", timezone: zone }, "en"), "Every day at 03:00 AM");
  assert.equal(repeats({ kind: "repeat", cron: "30 * * * *", timezone: zone }, "en"), "At 30 minutes past the hour");
  assert.equal(repeats({ kind: "repeat", cron: "0 * * * *", timezone: zone }, "en"), "Every hour");
});

test("a schedule's words follow the language: Chinese, with full-width commas", () => {
  assert.equal(repeats({ kind: "repeat", cron: "0 3 * * *", timezone: zone }, "zh-CN"), "每天 03:00");
  assert.equal(repeats({ kind: "repeat", cron: "0 9 * * 1", timezone: zone }, "zh-CN"), "在上午 09:00，仅星期一");
  assert.equal(repeats({ kind: "repeat", cron: "0 * * * *", timezone: zone }, "zh-CN"), "每小时");
});

test("a schedule's zone other than the device's is named, in either language", () => {
  const other = zone === "Asia/Tokyo" ? "Europe/Paris" : "Asia/Tokyo";
  assert.equal(repeats({ kind: "repeat", cron: "0 3 * * *", timezone: other }, "en"), `Every day at 03:00 AM (${other})`);
  assert.equal(repeats({ kind: "repeat", cron: "0 3 * * *", timezone: other }, "zh-CN"), `每天 03:00 (${other})`);
});

test("an instant reads as today, tomorrow, yesterday or a date, in the language", () => {
  const now = new Date(2026, 9, 21, 9, 0);
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
  assert.equal(moment(at(21, 8), now, "en"), "Today, 8:00 AM");
  assert.equal(moment(at(22, 8), now, "en"), "Tomorrow, 8:00 AM");
  assert.equal(moment(at(20, 8), now, "en"), "Yesterday, 8:00 AM");
  assert.equal(moment(at(23, 8), now, "en"), "Fri, Oct 23, 8:00 AM");
  assert.equal(moment(at(21, 8), now, "zh-CN"), "今天 8:00");
  assert.equal(moment(at(22, 8), now, "zh-CN"), "明天 8:00");
  assert.equal(moment(at(20, 8), now, "zh-CN"), "昨天 8:00");
  assert.equal(moment(at(23, 8), now, "zh-CN"), "10月23日周五 8:00");
});

const schedule: Schedule = {
  kind: "schedule",
  id: "s-1",
  at: "2026-10-21T08:00:00.000Z",
  title: "Morning briefing",
  instructions: "  Summarise the mail that needs an answer today.  ",
  when: { kind: "repeat", cron: "0 8 * * *", timezone: zone },
  status: "active",
  next: "2026-10-22T08:00:00.000Z",
  running: false,
  last: null,
  needs: null,
  preset: false,
  goal: null,
};

test("a schedule card's subtitle names the task, and says when it is paused, done, cancelled or running", () => {
  assert.equal(cardSubtitle(schedule, "en"), "Scheduled task");
  assert.equal(cardSubtitle({ ...schedule, status: "paused", next: null }, "en"), "Scheduled task · Paused");
  assert.equal(cardSubtitle({ ...schedule, status: "done", next: null }, "en"), "Scheduled task · Done");
  assert.equal(cardSubtitle({ ...schedule, status: "cancelled", next: null }, "en"), "Scheduled task · Cancelled");
  assert.equal(cardSubtitle({ ...schedule, running: true }, "en"), "Scheduled task · Running now");
  assert.equal(cardSubtitle(schedule, "zh-CN"), "定时任务");
  assert.equal(cardSubtitle({ ...schedule, status: "paused", next: null }, "zh-CN"), "定时任务 · 已暂停");
});

test("a schedule card's summary is when it runs, then what it does", () => {
  assert.equal(cardSummary(schedule, "en"), "Every day at 08:00 AM. Summarise the mail that needs an answer today.");
});

test("only an active or paused schedule is still in Settings, so only it gets the View button", () => {
  assert.equal(standing(schedule), true);
  assert.equal(standing({ ...schedule, status: "paused", next: null }), true);
  assert.equal(standing({ ...schedule, status: "done", next: null }), false);
  assert.equal(standing({ ...schedule, status: "cancelled", next: null }), false);
});
