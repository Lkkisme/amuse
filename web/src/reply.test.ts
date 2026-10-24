import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogOf } from "./i18n/language.ts";
import { quoteLine } from "./reply.ts";

test("a quoted message reads as its words, a quoted card as its kind and title, in the language", () => {
  const en = catalogOf("en");
  const zh = catalogOf("zh-CN");
  assert.equal(quoteLine({ id: "r1", kind: "reply", text: "Shall I book it?", state: null }, en), "Shall I book it?");
  assert.equal(quoteLine({ id: "s1", kind: "schedule", text: "Morning briefing", state: "paused" }, en), "Scheduled task · Morning briefing");
  assert.equal(quoteLine({ id: "s1", kind: "schedule", text: "晨报", state: "paused" }, zh), "定时任务 · 晨报");
  assert.equal(quoteLine({ id: "x1", kind: "failure", text: "", state: "open" }, en), "Couldn't reply");
  assert.equal(quoteLine({ id: "r2", kind: "reply", text: "", state: null }, zh), "消息");
});
