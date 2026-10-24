import assert from "node:assert/strict";
import { test } from "node:test";
import { splitDetail } from "./approval.ts";

test("the reason, then the arguments one Field: value a line", () => {
  const split = splitDetail("Update the notes.\n\nOwner: me\nRepo: amuse\nPath: docs/a.md");
  assert.equal(split.reason, "Update the notes.");
  assert.deepEqual(split.parameters, [
    { label: "Owner", value: "me" },
    { label: "Repo", value: "amuse" },
    { label: "Path", value: "docs/a.md" },
  ]);
});

test("a value of several lines, blank ones too, stays one value", () => {
  const split = splitDetail("Why.\n\nMessage: hi\nContent: ## A\n\n- b\nBranch: x");
  assert.deepEqual(split.parameters, [
    { label: "Message", value: "hi" },
    { label: "Content", value: "## A\n\n- b" },
    { label: "Branch", value: "x" },
  ]);
});

test("a detail with no arguments is all reason", () => {
  assert.deepEqual(splitDetail("Table for 4"), { reason: "Table for 4", parameters: [] });
  assert.deepEqual(splitDetail("https://example.com\nto read the menu"), { reason: "https://example.com\nto read the menu", parameters: [] });
});

test("what is said about a sensitive step stays in the reason", () => {
  const said = "Why.\n\nAmuse wants to put it in the sandbox as $TOKEN.\n\nPrograms in the sandbox can read it.";
  assert.deepEqual(splitDetail(said), { reason: said, parameters: [] });
  const list = "Forget these?\n\n- likes tea\n- lives in Oslo";
  assert.deepEqual(splitDetail(list), { reason: list, parameters: [] });
});

test("arguments with no reason in front are all parameters", () => {
  assert.deepEqual(splitDetail("Owner: me\nRepo: amuse"), {
    reason: "",
    parameters: [
      { label: "Owner", value: "me" },
      { label: "Repo", value: "amuse" },
    ],
  });
});
