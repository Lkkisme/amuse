import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogOf } from "./i18n/language.ts";
import { askLine, asking, quoteLine } from "./reply.ts";
import { type Ui, initialUi } from "./ui.ts";

test("a quoted message reads as its words, a quoted card as its kind and title, in the language", () => {
  const en = catalogOf("en");
  const zh = catalogOf("zh-CN");
  assert.equal(quoteLine({ id: "r1", kind: "reply", text: "Shall I book it?", state: null }, en), "Shall I book it?");
  assert.equal(quoteLine({ id: "s1", kind: "schedule", text: "Morning briefing", state: "paused" }, en), "Scheduled task · Morning briefing");
  assert.equal(quoteLine({ id: "s1", kind: "schedule", text: "晨报", state: "paused" }, zh), "定时任务 · 晨报");
  assert.equal(quoteLine({ id: "x1", kind: "failure", text: "", state: "open" }, en), "Couldn't reply");
  assert.equal(quoteLine({ id: "p1", kind: "prompt", text: "", state: null }, zh), "你的消息");
  assert.equal(quoteLine({ id: "r2", kind: "reply", text: "", state: null }, zh), "消息");
});

test("a quoted error reads as the message the user saw", () => {
  assert.equal(quoteLine({ id: "e1", kind: "error", text: "Voice needs a key", state: null, detail: "code: x" }, catalogOf("en")), "Voice needs a key");
  assert.equal(quoteLine({ id: "e1", kind: "error", text: "", state: null }, catalogOf("zh-CN")), "出错了");
});

test("Ask Amuse puts the error over the composer and sends nothing: it only changes what is on screen", () => {
  const was: Ui = { ...initialUi, chat: "main", notice: "Voice needs a key", noticeAbout: { detail: "code: x" }, settings: { ...initialUi.settings, open: true, section: "models" } };
  const now = asking(was, "main", { message: "Voice needs a key", detail: "code: x" }, "error-1");
  assert.deepEqual(now.replying, { chat: "main", quote: { id: "error-1", kind: "error", text: "Voice needs a key", state: null, detail: "code: x" } });
  assert.equal(now.settings.open, false);
  assert.deepEqual([now.notice, now.noticeAbout], [null, null]);
  assert.equal(now.settings.section, "models", "it only closes Settings");
});

test("the line Ask Amuse fills in keeps what the user had typed", () => {
  assert.equal(askLine("", "I ran into this"), "I ran into this");
  assert.equal(askLine("  ", "I ran into this"), "I ran into this");
  assert.equal(askLine("it was the mic", "I ran into this"), "it was the mic");
});
