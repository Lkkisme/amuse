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
