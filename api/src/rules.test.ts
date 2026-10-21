import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileRules } from "./rules.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "amuse-rules-")), "rules.json");

test("rules survive a restart, the file stays the owner's, and a broken file stops the start", async () => {
  const path = fresh();
  await fileRules(path).set("gmail", "destructive", "deny");
  await fileRules(path).setSite("bank.com", { never: true, actions: {} });
  await fileRules(path).setSiteAction("a5.ucsd.edu", "submit", "allow");
  await fileRules(path).setBrowser("download", "ask");
  assert.deepEqual(await fileRules(path).of("gmail"), { destructive: "deny" });
  assert.deepEqual(await fileRules(path).sites(), { "bank.com": { never: true, actions: {} }, "a5.ucsd.edu": { never: false, actions: { submit: "allow" } } });
  assert.deepEqual(await fileRules(path).browser(), { download: "ask" });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  writeFileSync(path, '{"apps":{"gmail":{"destructive":"maybe"}},"browser":{},"sites":{}}');
  assert.throws(() => fileRules(path));
  writeFileSync(path, '{"apps":{},"browser":{"upload":"allow"},"sites":{}}');
  assert.throws(() => fileRules(path), "uploads cannot be allowed");
});

test("the rules before the browser's: allow becomes every action allowed, ask becomes visit allowed, deny becomes never; the file is written again in the new shape", async () => {
  const path = fresh();
  writeFileSync(
    path,
    JSON.stringify({ apps: { gmail: { write: "allow" } }, sites: { "trusted.com": "allow", "news.example": "ask", "bank.com": "deny", "help.bank.com": "allow" } }),
  );
  const rules = fileRules(path);
  assert.deepEqual(await rules.sites(), {
    "trusted.com": { never: false, actions: { visit: "allow", submit: "allow", download: "allow" } },
    "news.example": { never: false, actions: { visit: "allow" } },
    "bank.com": { never: true, actions: {} },
    "help.bank.com": { never: false, actions: { visit: "allow", submit: "allow", download: "allow" } },
  });
  assert.deepEqual(await rules.browser(), {}, "the browser's own settings are the defaults");
  assert.deepEqual(await rules.of("gmail"), { write: "allow" }, "app rules are as they were");
  // written again, in the new shape, and read back the same
  const written: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(written, { apps: { gmail: { write: "allow" } }, browser: {}, sites: await rules.sites() });
  assert.deepEqual(await fileRules(path).sites(), await rules.sites());
  // a half old, half new file (one site already an exception) reads too
  writeFileSync(path, JSON.stringify({ apps: {}, browser: { visit: "allow" }, sites: { "a.com": "deny", "b.com": { never: false, actions: { submit: "deny" } } } }));
  assert.deepEqual(await fileRules(path).sites(), { "a.com": { never: true, actions: {} }, "b.com": { never: false, actions: { submit: "deny" } } });
  assert.deepEqual(await fileRules(path).browser(), { visit: "allow" });
});
