import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { browserRulesOf, decideBrowser } from "@amuse/core";
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
});

test("nothing stored that cannot be read stops the server or makes the rules wider: names read plainly, unreadable entries as never, the file kept beside", async () => {
  const path = fresh();
  writeFileSync(
    path,
    JSON.stringify({
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
    }),
  );
  const before = readFileSync(path, "utf8");
  const said: string[] = [];
  const rules = fileRules(path, (m) => void said.push(m));
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
  const kept = readdirSync(dirname(path)).filter((name) => name.endsWith(".bak"));
  assert.equal(kept.length, 1);
  assert.equal(readFileSync(join(dirname(path), kept[0] ?? ""), "utf8"), before);
  // written again without them: the next start is quiet and the same
  const next: string[] = [];
  assert.deepEqual(await fileRules(path, (m) => void next.push(m)).sites(), await rules.sites());
  assert.deepEqual(next, []);
  // a rule cannot be kept for a name that would not be read back
  for (const bad of ["evil.com.", "my_host.example.com", "[2606:4700::1111]", "nodots", "UPPER.com"]) {
    await assert.rejects(rules.setSiteAction(bad, "submit", "allow"), /not a website name/, bad);
    await assert.rejects(rules.setSite(bad, { never: true, actions: {} }), /not a website name/, bad);
  }
  assert.deepEqual(await fileRules(path, () => {}).sites(), await rules.sites(), "nothing bad was written");
});

test("migrating an ask under an allow keeps it as narrow as it was: submit and download are set as the defaults give them", async () => {
  const path = fresh();
  writeFileSync(
    path,
    JSON.stringify({
      apps: {},
      sites: { "bank.com": "allow", "login.bank.com": "ask", "other.com": "ask", "x.other.com": "ask", "deep.login.bank.com": "ask" },
    }),
  );
  const rules = fileRules(path);
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

test("the rules before the browser's: allow becomes every action allowed, ask becomes visit allowed, deny becomes never; the file is written again in the new shape", async () => {
  const path = fresh();
  writeFileSync(
    path,
    JSON.stringify({
      apps: { gmail: { write: "allow" } },
      sites: { "trusted.com": "allow", "news.example": "ask", "bank.com": "deny", "help.bank.com": "allow" },
    }),
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
  writeFileSync(
    path,
    JSON.stringify({ apps: {}, browser: { visit: "allow" }, sites: { "a.com": "deny", "b.com": { never: false, actions: { submit: "deny" } } } }),
  );
  assert.deepEqual(await fileRules(path).sites(), { "a.com": { never: true, actions: {} }, "b.com": { never: false, actions: { submit: "deny" } } });
  assert.deepEqual(await fileRules(path).browser(), { visit: "allow" });
});
