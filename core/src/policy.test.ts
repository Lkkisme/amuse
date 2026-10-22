import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserAction, Permission, SiteActions, SiteEntry } from "@amuse/protocol";
import { type BrowserRules, browserActions, hostOf, browserPermission, browserRulesOf, decideBrowser, defaultBrowser, defaultPermission, kindOf, memoryRules, permissionOf, ruleSaid, setSiteAction, setSiteEntry, siteOf, siteRuleFor, withSiteAction } from "./policy.ts";

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

test("a site is a URL's host without www; not a web page has no site", () => {
  assert.equal(siteOf("https://www.Bank.com/login"), "bank.com");
  assert.equal(siteOf("file:///etc/passwd"), null);
  assert.equal(siteOf("about:blank"), null);
});

const none: BrowserRules = { actions: {}, sites: {} };
const entry = (actions: SiteActions, never = false): SiteEntry => ({ never, actions });

test("the browser's defaults: ask to visit and to submit, keep downloads, ask to upload", () => {
  const expected: [BrowserAction, Permission][] = [["visit", "ask"], ["submit", "ask"], ["download", "allow"], ["upload", "ask"]];
  for (const [action, permission] of expected) {
    assert.equal(browserPermission(none, "https://news.example/", action), permission, action);
    assert.equal(defaultBrowser[action], permission, action);
  }
  assert.deepEqual(decideBrowser(none, "https://news.example/", "visit").source, { kind: "default" });
});

test("precedence: a site never visited > the nearest site that sets the action > the user's setting > the default", () => {
  const rules: BrowserRules = {
    actions: { visit: "allow", submit: "deny", download: "ask" },
    sites: {
      "bank.com": entry({ submit: "allow", download: "deny" }),
      "help.bank.com": entry({ submit: "ask" }),
      "evil.example": entry({ submit: "allow", visit: "allow" }, true),
      "a5.ucsd.edu": entry({ submit: "allow" }),
    },
  };
  const at = (url: string, action: BrowserAction) => browserPermission(rules, url, action);
  // never wins over everything: its own actions, the user's settings, and for every action
  for (const action of browserActions) assert.equal(at("https://evil.example/x", action), "deny", action);
  assert.equal(at("https://deep.sub.evil.example/", "visit"), "deny", "a subdomain of a never");
  assert.deepEqual(decideBrowser(rules, "https://deep.sub.evil.example/", "submit").source, { kind: "never", site: "evil.example" });
  // never in a parent beats a child that sets the action
  const parentNever: BrowserRules = { actions: {}, sites: { "bank.com": entry({}, true), "help.bank.com": entry({ visit: "allow", submit: "allow" }) } };
  assert.equal(browserPermission(parentNever, "https://help.bank.com/", "visit"), "deny");
  assert.equal(browserPermission(parentNever, "https://help.bank.com/", "submit"), "deny");
  // the nearest site rule that sets the action
  assert.equal(at("https://help.bank.com/", "submit"), "ask", "the subdomain's own");
  assert.equal(at("https://login.bank.com/", "submit"), "allow", "the parent's");
  assert.deepEqual(decideBrowser(rules, "https://login.bank.com/", "submit").source, { kind: "site", site: "bank.com" });
  assert.equal(at("https://help.bank.com/", "download"), "deny", "an action the subdomain does not set goes to the parent");
  assert.equal(at("https://notbank.com/", "submit"), "deny", "a different site is not covered");
  // the user's setting, then the default
  assert.equal(at("https://news.example/", "visit"), "allow");
  assert.deepEqual(decideBrowser(rules, "https://news.example/", "download").source, { kind: "global" });
  assert.equal(at("https://news.example/", "upload"), "ask", "the default");
  assert.equal(at("https://a5.ucsd.edu/", "submit"), "allow");
  // not a web page: there is nothing to do there
  assert.equal(at("about:blank", "visit"), "deny");
  assert.equal(at("file:///etc/passwd", "download"), "deny");
});

test("a user's file is never uploaded without asking, whatever is set", () => {
  const rules: BrowserRules = { actions: { upload: "allow" }, sites: { "x.com": entry({ upload: "allow" }) } };
  assert.equal(browserPermission(rules, "https://y.com/", "upload"), "ask");
  assert.equal(browserPermission(rules, "https://x.com/", "upload"), "ask");
  assert.equal(browserPermission({ actions: { upload: "deny" }, sites: {} }, "https://y.com/", "upload"), "deny");
});

test("a rule is said in words, with where it comes from", () => {
  assert.equal(ruleSaid({ kind: "never", site: "bank.com" }, "submit"), "your rule for bank.com (never visit it)");
  assert.equal(ruleSaid({ kind: "site", site: "a5.ucsd.edu" }, "download"), "your rule for a5.ucsd.edu (downloading files: Deny)");
  assert.equal(ruleSaid({ kind: "global" }, "submit"), "your setting for submitting forms (Deny)");
  assert.equal(ruleSaid({ kind: "unreachable" }, "visit"), "it is not a web page");
});

test("a site's exceptions are set one action at a time; denying a visit is never; nothing left is no entry", () => {
  assert.deepEqual(withSiteAction(undefined, "submit", "allow"), entry({ submit: "allow" }));
  assert.deepEqual(withSiteAction(entry({ submit: "allow" }), "download", "deny"), entry({ submit: "allow", download: "deny" }));
  assert.deepEqual(withSiteAction(entry({ submit: "allow", download: "deny" }), "submit", null), entry({ download: "deny" }));
  assert.equal(withSiteAction(entry({ submit: "allow" }), "submit", null), null, "nothing left");
  // a visit denied is the site never visited, and then visit is not otherwise set
  assert.deepEqual(withSiteAction(entry({ visit: "allow", submit: "ask" }), "visit", "deny"), entry({ submit: "ask" }, true));
  assert.deepEqual(withSiteAction(undefined, "never", "deny"), entry({}, true));
  assert.equal(withSiteAction(entry({}, true), "never", null), null, "never lifted");
  assert.deepEqual(withSiteAction(entry({ submit: "ask" }, true), "never", null), entry({ submit: "ask" }));
  assert.deepEqual(withSiteAction(entry({}, true), "visit", "allow"), entry({}, true), "visiting cannot be allowed where it is never");
  // an upload cannot be allowed
  assert.deepEqual(withSiteAction(undefined, "upload", "allow"), entry({ upload: "ask" }));
  // what an answer for good on a card leaves
  assert.deepEqual(siteRuleFor("submit", true), { action: "submit", permission: "allow" });
  assert.deepEqual(siteRuleFor("submit", false), { action: "submit", permission: "deny" });
  assert.deepEqual(siteRuleFor("visit", true), { action: "visit", permission: "allow" });
  assert.deepEqual(siteRuleFor("visit", false), { action: "never", permission: "deny" });
});

test("browser and site rules are kept apart from app rules, and from each other", async () => {
  const rules = memoryRules();
  await rules.setSite("bank.com", entry({}, true));
  await rules.setSiteAction("a5.ucsd.edu", "submit", "allow");
  await rules.setBrowser("download", "ask");
  await rules.setBrowser("upload", "allow");
  assert.deepEqual(await rules.sites(), { "bank.com": entry({}, true), "a5.ucsd.edu": entry({ submit: "allow" }) });
  assert.deepEqual(await rules.browser(), { download: "ask", upload: "ask" });
  assert.deepEqual(await rules.of("bank.com"), {});
  assert.deepEqual(await browserRulesOf(rules), { actions: { download: "ask", upload: "ask" }, sites: await rules.sites() });
  await rules.setSite("bank.com", null);
  await rules.setSiteAction("a5.ucsd.edu", "submit", null);
  await rules.setBrowser("download", null);
  assert.deepEqual(await rules.sites(), {});
  assert.deepEqual(await rules.browser(), { upload: "ask" });
  await rules.setSite("empty.com", entry({}));
  assert.deepEqual(await rules.sites(), {}, "an entry with nothing in it is none");
});

test("Amuse's own sandbox is always open to its browsers, whatever the rules say of other sites", () => {
  const rules: BrowserRules = { actions: { visit: "deny", submit: "deny" }, sites: { sandbox: entry({}, true) } };
  assert.equal(browserPermission(rules, "http://sandbox:5173/", "visit"), "allow");
  assert.equal(browserPermission(rules, "http://sandbox:8000/app/", "submit"), "allow");
  assert.equal(browserPermission(rules, "http://sandbox:8000/app/", "upload"), "ask", "a file of the user's is still asked about");
  // only that name: a site that merely contains it is a site like any
  assert.equal(browserPermission(rules, "https://sandbox.example.com/", "visit"), "deny");
  assert.equal(browserPermission(rules, "https://mysandbox/", "visit"), "deny");
});

test("a trailing dot, case, a full-width or encoded dot, or www do not get round a site's rule", () => {
  const rules: BrowserRules = { actions: {}, sites: { "evil.com": entry({}, true), "ok.example": entry({ submit: "allow" }) } };
  for (const url of [
    "https://evil.com./x",
    "https://evil.com../x",
    "https://EVIL.com/x",
    "https://www.evil.com./x",
    "https://login.evil.com./x",
    "https://Login.Evil.COM./x",
    "https://evil%2Ecom/x",
    "https://evil。com/x",
    "http://evil.com.:8080/x",
    "https://user:pw@evil.com./x",
  ]) {
    assert.equal(browserPermission(rules, url, "visit"), "deny", url);
    assert.deepEqual(decideBrowser(rules, url, "submit").source, { kind: "never", site: "evil.com" }, url);
    assert.equal(siteOf(url), url.toLowerCase().includes("login") ? "login.evil.com" : "evil.com", url);
  }
  assert.equal(browserPermission(rules, "https://ok.example./pay", "submit"), "allow", "a site's own rule, with the dot");
  assert.equal(hostOf("https://www.Example.com./"), "example.com");
  // a name in another script is the URL parser's punycode, and a rule for it matches
  assert.equal(siteOf("https://münchen.de./"), "xn--mnchen-3ya.de");
});

test("a host no rule can name is still visited under the browser's settings, but has no site: nothing to keep a rule under", () => {
  const rules: BrowserRules = { actions: { visit: "allow", submit: "deny" }, sites: { "evil.com": entry({}, true) } };
  for (const url of ["http://[2606:4700::1111]/", "https://my_host.example.com/", "http://[::1]:8080/"]) {
    assert.equal(siteOf(url), null, url);
    assert.notEqual(hostOf(url), null, url);
    assert.equal(browserPermission(rules, url, "visit"), "allow", url);
    assert.deepEqual(decideBrowser(rules, url, "submit"), { permission: "deny", source: { kind: "global" } }, url);
  }
  assert.equal(hostOf("http://[2606:4700::1111]/"), "[2606:4700::1111]");
  // not a web page at all: no
  for (const url of ["about:blank", "file:///etc/passwd", "ftp://evil.com/", "not a url", "https://"]) assert.equal(browserPermission(rules, url, "visit"), "deny", url);
});

test("a rule cannot be kept for a name that would not be read back", () => {
  for (const bad of ["evil.com.", "my_host.example.com", "[2606:4700::1111]", "nodots", "Upper.com", "", "a b.com"]) {
    assert.throws(() => setSiteAction({}, bad, "submit", "allow"), /not a website name/, bad);
    assert.throws(() => setSiteEntry({}, bad, { never: true, actions: {} }), /not a website name/, bad);
  }
  assert.deepEqual(setSiteAction({}, "evil.com", "never", "deny"), { "evil.com": { never: true, actions: {} } });
});

test("a host no rule can name is still under its parents' rules: an underscore does not get round a site that is never visited", () => {
  const rules: BrowserRules = { actions: { visit: "allow" }, sites: { "evil.com": entry({}, true), "bank.com": entry({ submit: "deny" }) } };
  assert.deepEqual(decideBrowser(rules, "https://a_b.evil.com/x", "visit"), { permission: "deny", source: { kind: "never", site: "evil.com" } });
  assert.deepEqual(decideBrowser(rules, "https://x_y.login.bank.com/pay", "submit"), { permission: "deny", source: { kind: "site", site: "bank.com" } });
  assert.equal(browserPermission(rules, "https://my_host.example.com/", "visit"), "allow", "no parent with a rule: the browser's settings");
});
