import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentAction, type AgentIO, type Answer, browserRulesOf, decideBrowser, memoryRules } from "@amuse/core";
import { askToVisit, visitAnswer } from "./visits.ts";
import { type Read, pageText, privateAddress, readForAgent, readPage, visible, webTools } from "./web.ts";

const textOf = (read: Read) => (read.kind === "text" ? read.text : `${read.kind} ${read.url}`);

test("only the public internet is readable", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd7a:115c::1", "::ffff:10.0.0.1"])
    assert.ok(privateAddress(ip), ip);
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) assert.ok(!privateAddress(ip), ip);
});

test("a page's text: no scripts, styles or tags; entities decoded; whitespace folded", () => {
  const { title, text } = pageText(
    "<html><head><title>Tides &amp; times</title><style>p{}</style></head><body><script>alert(1)</script><h1>Low tide</h1><p>at 3:02&nbsp;pm</p></body></html>",
  );
  assert.equal(title, "Tides & times");
  assert.equal(text, "Low tide\nat 3:02 pm");
});

/** A fetch over a few fixed answers, by URL. */
const answering =
  (pages: Record<string, { status: number; location?: string; body?: string }>): typeof fetch =>
  async (input) => {
    const page = pages[String(input)];
    if (!page) return new Response("not here", { status: 404 });
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (page.location) headers["location"] = page.location;
    return new Response(page.body ?? "", { status: page.status, headers });
  };

test("this machine and private networks are not read, and neither are denied sites, redirects included", async () => {
  const rules = memoryRules();
  await rules.setSiteAction("93.184.216.34", "visit", "allow");
  assert.match(textOf(await readPage("http://127.0.0.1:8000/sessions", rules)), /not on the public web/);
  assert.match(textOf(await readPage("http://ab-controller-1:8000/", rules)), /not on the public web/);
  await rules.setSiteAction("1.1.1.1", "never", "deny");
  const http = answering({ "http://93.184.216.34/": { status: 302, location: "http://1.1.1.1/secret" } });
  assert.deepEqual(await readPage("http://93.184.216.34/", rules, http), {
    kind: "refused",
    url: "http://1.1.1.1/secret",
    source: { kind: "never", site: "1.1.1.1" },
  });
  const toInside = answering({ "http://93.184.216.34/": { status: 301, location: "http://10.0.0.2/admin" } });
  assert.match(textOf(await readPage("http://93.184.216.34/", rules, toInside)), /not on the public web/);
  const fine = answering({ "http://93.184.216.34/": { status: 200, body: "<title>Hi</title><p>Hello</p>" } });
  assert.equal(textOf(await readPage("http://93.184.216.34/", rules, fine)), "URL: http://93.184.216.34/\nTitle: Hi\n\nHello");
});

test("a site the rules leave to ask about is not read until the user allows it, redirects included", async () => {
  const rules = memoryRules();
  const fine = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hello</p>" } });
  assert.deepEqual(await readPage("http://1.1.1.1/", rules, fine), { kind: "ask", url: "http://1.1.1.1/" });
  assert.match(textOf(await readPage("http://1.1.1.1/", rules, fine, new Set(["1.1.1.1"]))), /Hello/);
  const onward = answering({ "http://1.1.1.1/": { status: 302, location: "http://8.8.8.8/" } });
  assert.deepEqual(await readPage("http://1.1.1.1/", rules, onward, new Set(["1.1.1.1"])), { kind: "ask", url: "http://8.8.8.8/" });
});

/** An agent's IO that records what it asks and is told, answering every approval with `answer`. */
function agentIO(answer: Answer) {
  const asked: AgentAction[] = [];
  const reports: string[] = [];
  const io: AgentIO = {
    chat: "main",
    chats: () => [],
    schedules: () => [],
    readChat: () => null,
    emit: () => {},
    act: (action) => (asked.push(action), { ok: true, id: "a1" }),
    decision: async () => answer,
    report: (note) => void reports.push(note),
    context: () => "",
    recall: () => "",
    time: () => ({ now: "2026-10-20T08:00:00Z", timezone: "UTC" }),
    lastWords: () => "",
    answer: async () => ({ kind: "closed" }),
    listen: () => () => {},
  };
  return { io, asked, reports };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

test("reading a site the rules leave to ask about asks the user, and reads it in the background once allowed; 'always' leaves a rule", async () => {
  const rules = memoryRules();
  const http = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hello</p>" } });
  const yes = agentIO({ verdict: "approved", remember: true });
  assert.match(await readForAgent(yes.io, rules, "http://1.1.1.1/", http), /user is asked first about visiting 1\.1\.1\.1/);
  assert.equal(yes.asked[0]?.kind === "ask" && yes.asked[0].action, "Visit");
  await settle();
  assert.match(yes.reports[0] ?? "", /page read[\s\S]*Hello/);
  assert.deepEqual(await rules.sites(), { "1.1.1.1": { never: false, actions: { visit: "allow" } } });
  // now it has a rule: read at once, nothing asked
  const again = agentIO({ verdict: "denied", remember: false });
  assert.match(await readForAgent(again.io, rules, "http://1.1.1.1/", http), /Hello/);
  assert.deepEqual(again.asked, []);

  const no = agentIO({ verdict: "denied", remember: false });
  await readForAgent(no.io, memoryRules(), "http://1.1.1.1/", http);
  await settle();
  assert.match(no.reports[0] ?? "", /did not allow/);
  const away = agentIO({ verdict: "timed_out", remember: false });
  await readForAgent(away.io, memoryRules(), "http://1.1.1.1/", http);
  await settle();
  assert.match(away.reports[0] ?? "", /did not answer/);
});

test("this machine is refused outright, without asking the user about it", async () => {
  const quiet = agentIO({ verdict: "approved", remember: false });
  assert.match(await readForAgent(quiet.io, memoryRules(), "http://127.0.0.1:8000/"), /not on the public web/);
  assert.deepEqual(quiet.asked, []);
});

test("a helper holds on the approval and reads on with the page; nothing goes to Amuse but that it waits", async () => {
  const http = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hello</p>" } });
  const held: string[] = [];
  const hold = { waiting: (what: string) => void held.push(`waiting ${what}`), working: () => void held.push("working") };
  const yes = agentIO({ verdict: "approved", remember: false });
  assert.match(await readForAgent(yes.io, memoryRules(), "http://1.1.1.1/", http, hold), /Hello/);
  assert.deepEqual(held, ["waiting to visit 1.1.1.1 (to read http://1.1.1.1/)", "working"]);
  assert.deepEqual(yes.reports, []);
  const no = agentIO({ verdict: "denied", remember: false });
  assert.match(await readForAgent(no.io, memoryRules(), "http://1.1.1.1/", http, hold), /did not allow/);
});

test("web_read under each visit setting: allowed reads at once, ask asks, deny is a hard no that is recorded and says which rule", async () => {
  const http = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hello</p>" } });
  // Allow: read at once, nothing asked
  const allowed = memoryRules();
  await allowed.setBrowser("visit", "allow");
  const a = agentIO({ verdict: "denied", remember: false });
  assert.match(await readForAgent(a.io, allowed, "http://1.1.1.1/", http), /Hello/);
  assert.deepEqual(a.asked, []);
  // Ask (the default): asked, and only read once allowed
  const ask = agentIO({ verdict: "approved", remember: false });
  assert.match(await readForAgent(ask.io, memoryRules(), "http://1.1.1.1/", http), /user is asked first/);
  assert.equal(ask.asked.length, 1);
  assert.equal(ask.asked[0]?.kind, "ask");
  // Deny: refused, no card, recorded, and the agent is told the rule and where to change it
  const denied = memoryRules();
  await denied.setBrowser("visit", "deny");
  const d = agentIO({ verdict: "approved", remember: true });
  const told = await readForAgent(d.io, denied, "http://1.1.1.1/", http);
  assert.match(told, /^Refused by your setting for visiting websites \(Deny\): visiting 1\.1\.1\.1 is not allowed\. Nothing was asked\./);
  assert.match(told, /Settings › Permissions › Browser/);
  assert.match(told, /do not ask again unless the user brings it up/);
  assert.doesNotMatch(told, /<untrusted>/, "the rule is the system's word, not the web's");
  assert.deepEqual(d.asked, [{ kind: "refuse", action: "Visit", target: "1.1.1.1", detail: "Your setting for visiting websites (Deny)\nhttp://1.1.1.1/" }]);
  assert.deepEqual(d.reports, []);
  assert.deepEqual(await denied.sites(), {}, "no card, so no rule written");
  // a site that is never visited, under an Allow: still no
  const never = memoryRules();
  await never.setBrowser("visit", "allow");
  await never.setSiteAction("1.1.1.1", "never", "deny");
  const n = agentIO({ verdict: "approved", remember: false });
  assert.match(
    await readForAgent(n.io, never, "http://1.1.1.1/", http),
    /^Refused by your rule for 1\.1\.1\.1 \(never visit it\)[\s\S]*Settings › Permissions › 1\.1\.1\.1/,
  );
  assert.equal(n.asked[0]?.kind, "refuse");
  // a site's own visit rule beats the setting for everything
  const site = memoryRules();
  await site.setBrowser("visit", "deny");
  await site.setSiteAction("1.1.1.1", "visit", "allow");
  const s = agentIO({ verdict: "denied", remember: false });
  assert.match(await readForAgent(s.io, site, "http://1.1.1.1/", http), /Hello/);
  assert.deepEqual(s.asked, []);
});

test("a read that is redirected to a site the rules refuse is refused there, and recorded", async () => {
  const rules = memoryRules();
  await rules.setBrowser("visit", "allow");
  await rules.setSiteAction("1.1.1.1", "never", "deny");
  const http = answering({ "http://93.184.216.34/": { status: 302, location: "http://1.1.1.1/secret" } });
  const a = agentIO({ verdict: "approved", remember: false });
  assert.match(await readForAgent(a.io, rules, "http://93.184.216.34/", http), /^Refused by your rule for 1\.1\.1\.1 \(never visit it\)/);
  assert.equal(a.asked[0]?.kind === "refuse" && a.asked[0].target, "1.1.1.1");
});

test("web_search leaves out the sites the rules say no to, and keeps the rest", async () => {
  const rules = memoryRules();
  await rules.setSiteAction("bank.com", "never", "deny");
  const results = [
    { title: "Bank", url: "https://login.bank.com/", snippet: "x" },
    { title: "News", url: "https://news.example/", snippet: "y" },
  ];
  assert.deepEqual(
    visible(results, await browserRulesOf(rules)).map((r) => r.title),
    ["News"],
  );
  await rules.setBrowser("visit", "deny");
  assert.deepEqual(visible(results, await browserRulesOf(rules)), [], "a setting of Deny for visiting leaves none");
  assert.ok(
    webTools(
      () => agentIO({ verdict: "approved", remember: false }).io,
      rules,
      async () => results,
    ).some((t) => t.name === "web_search"),
  );
});

test("a trailing dot, case or www does not get round a site that is never visited: read, search and redirect", async () => {
  const rules = memoryRules();
  await rules.setBrowser("visit", "allow");
  await rules.setSiteAction("93.184.216.34", "never", "deny");
  await rules.setSiteAction("evil.example", "never", "deny");
  // the address itself, with a dot (an IP is also a host name)
  for (const url of ["http://93.184.216.34./", "http://93.184.216.34/"]) {
    const a = agentIO({ verdict: "approved", remember: false });
    assert.match(await readForAgent(a.io, rules, url, answering({})), /^Refused by your rule for 93\.184\.216\.34 \(never visit it\)/, url);
    assert.equal(a.asked[0]?.kind, "refuse");
  }
  for (const url of ["https://evil.example./x", "https://EVIL.example/x", "https://www.evil.example./x", "https://login.evil.example./"])
    assert.deepEqual(await readPage(url, rules, answering({})), { kind: "refused", url, source: { kind: "never", site: "evil.example" } }, url);
  // search leaves them out
  const results = [
    { title: "Evil", url: "https://evil.example./", snippet: "x" },
    { title: "Evil www", url: "https://WWW.Evil.Example/a", snippet: "x" },
    { title: "News", url: "https://news.example/", snippet: "y" },
  ];
  assert.deepEqual(
    visible(results, await browserRulesOf(rules)).map((r) => r.title),
    ["News"],
  );
  // a redirect to the dotted name is refused there
  const http = answering({ "http://93.184.216.34/": { status: 302, location: "https://evil.example./in" } });
  const redirected = await readPage("http://93.184.216.34/", rules, http);
  assert.equal(redirected.kind, "refused");
});

test("a page whose host no rule can name is read under the browser's settings, and 'Always' is not offered for it", async () => {
  const rules = memoryRules();
  const http = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hi</p>" } });
  // an address of the kind no rule can be kept for: refused as not public before anything is asked, so test the ask directly
  const a = agentIO({ verdict: "approved", remember: true });
  const card = askToVisit(a.io, "http://[2606:4700::1111]/", "To read");
  assert.ok(card.ok);
  assert.deepEqual(a.asked, [{ kind: "ask", action: "Visit", target: "[2606:4700::1111]", detail: "http://[2606:4700::1111]/\nTo read", remember: false }]);
  assert.equal(await visitAnswer(a.io, rules, "a1", "http://[2606:4700::1111]/"), "approved");
  assert.deepEqual(await rules.sites(), {}, "nothing was kept, and nothing could break the rules file");
  const named = agentIO({ verdict: "approved", remember: true });
  askToVisit(named.io, "https://news.example./x", "To read");
  assert.deepEqual(named.asked[0], { kind: "ask", action: "Visit", target: "news.example", detail: "https://news.example./x\nTo read", remember: true });
  await visitAnswer(named.io, rules, "a1", "https://news.example./x");
  assert.deepEqual(await rules.sites(), { "news.example": { never: false, actions: { visit: "allow" } } }, "the trailing dot is not kept");
  assert.match(textOf(await readPage("http://1.1.1.1/", rules, http, new Set(["1.1.1.1"]))), /Hi/);
});
