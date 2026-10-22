import assert from "node:assert/strict";
import { test } from "node:test";
import { moment, repeats } from "./schedules.ts";

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
