import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { browserRulesOf, decideBrowser } from "@amuse/core";
import { StartupError, openDatabase } from "@amuse/db";
import { type Location, locate, openData } from "./data.ts";
import { sqliteRules } from "./rules.ts";

const folder = () => mkdtempSync(join(tmpdir(), "amuse-rules-"));

/** The data folder with a rules.json of the given shape in it, started the way the server starts: imported, then read from the database. */
async function startedWith(content: unknown) {
  const dir = folder();
  writeFileSync(join(dir, "rules.json"), typeof content === "string" ? content : JSON.stringify(content));
  const said: string[] = [];
  const db = await openData(locate({ AMUSE_DATA: dir }), (message) => void said.push(message));
  return { dir, said, db, rules: sqliteRules(db) };
}

test("rules survive a restart, and the database stays the owner's", async () => {
  const dir = folder();
  const where: Location = locate({ AMUSE_DATA: dir });
  const first = sqliteRules(await openData(where, () => {}));
  await first.set("gmail", "destructive", "deny");
  await first.setSite("bank.com", { never: true, actions: {} });
  await first.setSiteAction("a5.ucsd.edu", "submit", "allow");
  await first.setBrowser("download", "ask");
  const second = sqliteRules(await openData(where, () => {}));
  assert.deepEqual(await second.of("gmail"), { destructive: "deny" });
  assert.deepEqual(await second.sites(), { "bank.com": { never: true, actions: {} }, "a5.ucsd.edu": { never: false, actions: { submit: "allow" } } });
  assert.deepEqual(await second.browser(), { download: "ask" });
  assert.equal(statSync(where.database).mode & 0o777, 0o600);
});

test("a rules file that cannot be read stops the start and is left as it was", async () => {
  const dir = folder();
  const bad = '{"apps":{"gmail":{"destructive":"maybe"}},"browser":{},"sites":{}}';
  writeFileSync(join(dir, "rules.json"), bad);
  await assert.rejects(openData(locate({ AMUSE_DATA: dir }), () => {}), (error) => error instanceof StartupError && error.problem.kind === "migration-failed");
  assert.equal(readFileSync(join(dir, "rules.json"), "utf8"), bad);
  assert.equal(existsSync(join(dir, "rules.json.bak")), false);
});

test("nothing stored that cannot be read stops the server or makes the rules wider: names read plainly, unreadable entries as never, the file kept beside", async () => {
  const content = JSON.stringify({
    apps: {},
    browser: { upload: "allow", download: "ask", visit: "sometimes" },
    sites: {
      "evil.com.": { never: true, actions: {} },
      "WWW.Shop.com": { never: false, actions: { submit: "allow" } },
      "shop.com": { never: false, actions: { submit: "deny", download: "allow" } },
      "my_host.example.com": "allow",
      "[2606:4700::1111]": { never: true, actions: {} },
      "ok.com": { never: false, actions: { upload: "allow", submit: "allow" } },
      "broken.com": { never: "yes" },
      "fine.com": "deny",
    },
  });
  const { dir, said, db, rules } = await startedWith(content);
  assert.deepEqual(await rules.sites(), {
    // a spelling of a name is that name; two entries for one name keep the stricter of each
    "evil.com": { never: true, actions: {} },
    "shop.com": { never: false, actions: { submit: "deny", download: "allow" } },
    "ok.com": { never: false, actions: { upload: "ask", submit: "allow" } },
    // what cannot be read is never visited, until set again
    "broken.com": { never: true, actions: {} },
    "fine.com": { never: true, actions: {} },
  });
  // a setting that cannot be read asks
  assert.deepEqual(await rules.browser(), { upload: "ask", download: "ask", visit: "ask" });
  // only names no rule can be kept under are dropped
  assert.equal(said.filter((m) => /dropped/.test(m)).length, 2);
  assert.ok(said.some((m) => m.includes("my_host.example.com") && /dropped/.test(m)));
  assert.ok(said.some((m) => m.includes("[2606:4700::1111]") && /dropped/.test(m)));
  assert.ok(said.some((m) => m.includes('"evil.com."') && /kept as evil.com/.test(m)));
  assert.ok(said.some((m) => m.includes("broken.com") && /never visiting/.test(m)));
  assert.ok(said.some((m) => /setting for visit/.test(m)));
  assert.equal(said.filter((m) => /uploading is always asked about/.test(m)).length, 2);
  // the file as it was is kept beside it
  assert.equal(readFileSync(join(dir, "rules.json.bak"), "utf8"), content);
  // the next start is quiet and the same
  db.close();
  const next: string[] = [];
  const again = sqliteRules(await openData(locate({ AMUSE_DATA: dir }), (m) => void next.push(m)));
  assert.deepEqual(await again.sites(), await rules.sites());
  assert.deepEqual(next, []);
  // a rule cannot be kept for a name that would not be read back
  for (const bad of ["evil.com.", "my_host.example.com", "[2606:4700::1111]", "nodots", "UPPER.com"]) {
    await assert.rejects(rules.setSiteAction(bad, "submit", "allow"), /not a website name/, bad);
    await assert.rejects(rules.setSite(bad, { never: true, actions: {} }), /not a website name/, bad);
  }
});

test("migrating an ask under an allow keeps it as narrow as it was: submit and download are set as the defaults give them", async () => {
  const { rules } = await startedWith({
    apps: {},
    sites: { "bank.com": "allow", "login.bank.com": "ask", "other.com": "ask", "x.other.com": "ask", "deep.login.bank.com": "ask" },
  });
  const sites = await rules.sites();
  assert.deepEqual(sites["login.bank.com"], { never: false, actions: { visit: "allow", submit: "ask", download: "allow" } });
  assert.deepEqual(sites["deep.login.bank.com"], sites["login.bank.com"], "an allow anywhere above counts");
  assert.deepEqual(sites["other.com"], { never: false, actions: { visit: "allow" } }, "no allow above: nothing to hold back");
  assert.deepEqual(sites["x.other.com"], { never: false, actions: { visit: "allow" } });
  // what resolves, as before: bank.com allows, login.bank.com and below ask
  const browser = await browserRulesOf(rules);
  const at = (url: string) => decideBrowser(browser, url, "submit").permission;
  assert.equal(at("https://bank.com/"), "allow");
  assert.equal(at("https://www2.bank.com/"), "allow");
  assert.equal(at("https://login.bank.com/"), "ask");
  assert.equal(at("https://deep.login.bank.com/"), "ask");
  assert.equal(at("https://a.deep.login.bank.com/"), "ask");
  assert.equal(decideBrowser(browser, "https://login.bank.com/", "visit").permission, "allow");
  assert.equal(decideBrowser(browser, "https://login.bank.com/", "download").permission, "allow");
});

test("the rules before the browser's: allow becomes every action allowed, ask becomes visit allowed, deny becomes never", async () => {
  const { rules } = await startedWith({
    apps: { gmail: { write: "allow" } },
    sites: { "trusted.com": "allow", "news.example": "ask", "bank.com": "deny", "help.bank.com": "allow" },
  });
  assert.deepEqual(await rules.sites(), {
    "trusted.com": { never: false, actions: { visit: "allow", submit: "allow", download: "allow" } },
    "news.example": { never: false, actions: { visit: "allow" } },
    "bank.com": { never: true, actions: {} },
    "help.bank.com": { never: false, actions: { visit: "allow", submit: "allow", download: "allow" } },
  });
  assert.deepEqual(await rules.browser(), {}, "the browser's own settings are the defaults");
  assert.deepEqual(await rules.of("gmail"), { write: "allow" }, "app rules are as they were");
});

test("a half old, half new file reads too, and a site in both shapes keeps the stricter of each", async () => {
  const half = await startedWith({ apps: {}, browser: { visit: "allow" }, sites: { "a.com": "deny", "b.com": { never: false, actions: { submit: "deny" } } } });
  assert.deepEqual(await half.rules.sites(), { "a.com": { never: true, actions: {} }, "b.com": { never: false, actions: { submit: "deny" } } });
  assert.deepEqual(await half.rules.browser(), { visit: "allow" });
  const both = await startedWith({ apps: {}, browser: {}, sites: { "EVIL.com": "deny", "evil.com": { never: false, actions: { visit: "allow" } } } });
  assert.equal((await both.rules.sites())["evil.com"]?.never, true);
});

test("rules held in a database opened on its own are the same as through the server's start", async () => {
  const dir = folder();
  const db = await openData(locate({ AMUSE_DATA: dir }), () => {});
  await sqliteRules(db).set("slack", "write", "ask");
  db.close();
  assert.deepEqual(await sqliteRules(openDatabase(join(dir, "amuse.db"))).of("slack"), { write: "ask" });
});
