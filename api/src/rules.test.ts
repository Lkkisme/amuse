import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileRules } from "./rules.ts";

test("rules survive a restart, the file stays the owner's, and a broken file stops the start", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "remuse-rules-")), "rules.json");
  await fileRules(path).set("gmail", "destructive", "deny");
  assert.deepEqual(await fileRules(path).of("gmail"), { destructive: "deny" });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  writeFileSync(path, '{"gmail":{"destructive":"maybe"}}');
  assert.throws(() => fileRules(path));
});
