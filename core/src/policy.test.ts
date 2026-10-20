import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPermission, kindOf, memoryRules, permissionOf } from "./policy.ts";

test("a tool's own hints decide its kind; without any, its name does", () => {
  assert.equal(kindOf("GMAIL_FETCH_EMAILS", ["readOnlyHint", "openWorldHint"]), "read");
  assert.equal(kindOf("GMAIL_DELETE_MESSAGE", ["destructiveHint"]), "destructive");
  assert.equal(kindOf("GMAIL_LIST_LABELS_AND_FORWARD", ["openWorldHint"]), "write"); // hinted, not read-only
  assert.equal(kindOf("GMAIL_FETCH_EMAILS", []), "read");
  assert.equal(kindOf("GMAIL_SEND_EMAIL", []), "write");
  assert.equal(kindOf("NOTION_ARCHIVE_PAGE", []), "destructive");
  assert.equal(kindOf("SOMETHING_ODD", []), "write"); // not plainly a read
});

test("reads are allowed, everything else asked about, unless the user chose otherwise", () => {
  assert.equal(defaultPermission("read"), "allow");
  assert.equal(defaultPermission("write"), "ask");
  assert.equal(defaultPermission("destructive"), "ask");
  assert.equal(permissionOf("read", { read: "deny" }), "deny");
  assert.equal(permissionOf("write", { read: "deny" }), "ask");
});

test("rules are kept per app and go back to the default when cleared", async () => {
  const rules = memoryRules();
  await rules.set("gmail", "write", "allow");
  assert.deepEqual(await rules.of("gmail"), { write: "allow" });
  assert.deepEqual(await rules.of("notion"), {});
  await rules.set("gmail", "write", null);
  assert.deepEqual(await rules.of("gmail"), {});
});
