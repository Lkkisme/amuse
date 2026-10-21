import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS, summary } from "./browserRules.ts";

test("a website's exceptions are summed up in a line: Never, or each action set, in the order the browser lists them", () => {
  assert.equal(summary({ never: true, actions: {} }), "Never");
  assert.equal(
    summary({ never: true, actions: { submit: "allow" } }),
    "Never",
    "never wins over everything",
  );
  assert.equal(
    summary({ never: false, actions: { submit: "allow", visit: "allow" } }),
    "Visit: Allow · Submit: Allow",
  );
  assert.equal(
    summary({ never: false, actions: { upload: "deny", download: "ask" } }),
    "Download: Ask · Upload: Deny",
  );
  assert.equal(summary({ never: false, actions: {} }), "");
});

test("the four actions are listed, and an upload cannot be allowed", () => {
  assert.deepEqual(
    ACTIONS.map((a) => a.id),
    ["visit", "submit", "download", "upload"],
  );
  assert.deepEqual(ACTIONS.find((a) => a.id === "upload")?.options, [
    "ask",
    "deny",
  ]);
  for (const a of ACTIONS.filter((a) => a.id !== "upload"))
    assert.deepEqual(a.options, ["allow", "ask", "deny"]);
});
