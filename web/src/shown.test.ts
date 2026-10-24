/**
 * What Connections says when something fails, and where: the list's own failures, and the open app's.
 * The bug this covers: an error about one app (its page could not be read, so the page said it cannot be
 * connected here) stayed in the shared state and showed on the list after the user went back.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Dropped } from "@amuse/api/client";
import { activeT } from "./i18n/language.ts";
import { type Failures, failedAt, noFailures, pageLeft, wentThrough, wordsFor } from "./shown.ts";

const t = activeT();
const grafana = new Error("Grafana Cloud MCP needs credentials of your own that Amuse cannot set up yet, so it cannot be connected here.");

test("a failure about an app stays on its page: the list never shows it, and leaving lets it go", () => {
  // opening a toolkit whose page could not be read: nothing of it reaches the list
  const opened = failedAt(noFailures, "page", grafana);
  assert.equal(wordsFor(opened.page, t), grafana.message);
  assert.equal(wordsFor(opened.list, t), null, "the list shows nothing of another page's failure");

  // a search failing while a page is open is the list's own, and stays there
  const both = failedAt(opened, "list", new Error("the search failed"));
  assert.equal(wordsFor(both.list, t), "the search failed");

  // going back: the app's failure goes with the page, the list keeps its own
  const left = pageLeft(both);
  assert.equal(wordsFor(left.page, t), null);
  assert.equal(wordsFor(left.list, t), "the search failed");
  assert.equal(JSON.stringify(left.list).includes("Grafana"), false);
});

test("a dropped connection does not stand once a call has gone through; a refusal does", () => {
  const dropped: Failures = failedAt(failedAt(noFailures, "list", new Dropped()), "page", new Dropped());
  assert.equal(wordsFor(dropped.list, t), t.common.serverUnreachable);
  assert.equal(wordsFor(dropped.page, t), t.common.serverUnreachable);
  const through = wentThrough(dropped);
  assert.equal(wordsFor(through.list, t), null);
  assert.equal(wordsFor(through.page, t), null);

  const refused: Failures = failedAt(failedAt(noFailures, "list", new Error("no such app")), "page", grafana);
  const after = wentThrough(refused);
  assert.equal(wordsFor(after.list, t), "no such app", "a call the server refused still stands");
  assert.equal(wordsFor(after.page, t), grafana.message);
});

test("a refused command is said in the user's language, never as the rule's own English; the raw text is kept for the agent", async () => {
  const { CallFailed } = await import("@amuse/api/client");
  const { Rejected } = await import("@amuse/core");
  const { catalogOf } = await import("./i18n/language.ts");
  const { rawOf } = await import("./shown.ts");
  const en = catalogOf("en");
  const zh = catalogOf("zh-CN");
  // over the wire (a CallFailed carrying the rejection) and in the demo (the host's own Rejected)
  const wire = new CallFailed("cannot stop from stopped", -32000, { kind: "invalid", action: "stop", from: "stopped" });
  const demo = new Rejected({ kind: "invalid", action: "stop", from: "stopped" });
  for (const error of [wire, demo]) {
    assert.equal(wordsFor(error, en), en.rejected.invalid);
    assert.equal(wordsFor(error, zh), zh.rejected.invalid);
    assert.ok(!/cannot stop from stopped/.test(wordsFor(error, en) ?? ""));
    assert.match(rawOf(error), /cannot stop from stopped/);
  }
  for (const rejection of [
    { kind: "notFound", entity: "reply", id: "r9" },
    { kind: "gone", id: "b1" },
    { kind: "notRunning", id: "b1" },
    { kind: "noChat", id: "c9" },
    { kind: "noFile", id: "f1" },
    { kind: "mainChat" },
  ] as const) {
    const said = new Rejected(rejection);
    assert.equal(wordsFor(said, zh), zh.rejected[rejection.kind]);
    assert.ok(!/\b(r9|b1|c9|f1)\b/.test(wordsFor(said, en) ?? ""), "no ids in the user's words");
  }
  // an unsound rule carries a sentence of its own: shown in English, replaced in Chinese
  const unsound = new CallFailed("There is already an entry called Gmail.", -32000, { kind: "unsound", reason: "There is already an entry called Gmail." });
  assert.equal(wordsFor(unsound, en), "There is already an entry called Gmail.");
  assert.equal(wordsFor(unsound, zh), zh.rejected.unsound(""));
  // anything else keeps its words
  assert.equal(wordsFor(new Error("boom"), en), "boom");
});
