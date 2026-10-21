import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentAction, type AgentIO, type Answer, memoryRules } from "@remuse/core";
import { type Read, pageText, privateAddress, readForAgent, readPage } from "./web.ts";

const textOf = (read: Read) => (read.kind === "text" ? read.text : `unlisted ${read.url}`);

test("only the public internet is readable", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd7a:115c::1", "::ffff:10.0.0.1"]) assert.ok(privateAddress(ip), ip);
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) assert.ok(!privateAddress(ip), ip);
});

test("a page's text: no scripts, styles or tags; entities decoded; whitespace folded", () => {
  const { title, text } = pageText("<html><head><title>Tides &amp; times</title><style>p{}</style></head><body><script>alert(1)</script><h1>Low tide</h1><p>at 3:02&nbsp;pm</p></body></html>");
  assert.equal(title, "Tides & times");
  assert.equal(text, "Low tide\nat 3:02 pm");
});

/** A fetch over a few fixed answers, by URL. */
const answering = (pages: Record<string, { status: number; location?: string; body?: string }>): typeof fetch => async (input) => {
  const page = pages[String(input)];
  if (!page) return new Response("not here", { status: 404 });
  const headers: Record<string, string> = { "content-type": "text/html" };
  if (page.location) headers["location"] = page.location;
  return new Response(page.body ?? "", { status: page.status, headers });
};

test("this machine and private networks are not read, and neither are denied sites, redirects included", async () => {
  const rules = memoryRules();
  await rules.setSite("93.184.216.34", "ask");
  assert.match(textOf(await readPage("http://127.0.0.1:8000/sessions", rules)), /not on the public web/);
  assert.match(textOf(await readPage("http://ab-controller-1:8000/", rules)), /not on the public web/);
  await rules.setSite("1.1.1.1", "deny");
  const http = answering({ "http://93.184.216.34/": { status: 302, location: "http://1.1.1.1/secret" } });
  assert.match(textOf(await readPage("http://93.184.216.34/", rules, http)), /does not allow 1\.1\.1\.1/);
  const toInside = answering({ "http://93.184.216.34/": { status: 301, location: "http://10.0.0.2/admin" } });
  assert.match(textOf(await readPage("http://93.184.216.34/", rules, toInside)), /not on the public web/);
  const fine = answering({ "http://93.184.216.34/": { status: 200, body: "<title>Hi</title><p>Hello</p>" } });
  assert.equal(textOf(await readPage("http://93.184.216.34/", rules, fine)), "URL: http://93.184.216.34/\nTitle: Hi\n\nHello");
});

test("a site with no rule is not read until the user allows it, redirects included", async () => {
  const rules = memoryRules();
  const fine = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hello</p>" } });
  assert.deepEqual(await readPage("http://1.1.1.1/", rules, fine), { kind: "unlisted", url: "http://1.1.1.1/" });
  assert.match(textOf(await readPage("http://1.1.1.1/", rules, fine, new Set(["1.1.1.1"]))), /Hello/);
  const onward = answering({ "http://1.1.1.1/": { status: 302, location: "http://8.8.8.8/" } });
  assert.deepEqual(await readPage("http://1.1.1.1/", rules, onward, new Set(["1.1.1.1"])), { kind: "unlisted", url: "http://8.8.8.8/" });
});

/** An agent's IO that records what it asks and is told, answering every approval with `answer`. */
function agentIO(answer: Answer) {
  const asked: AgentAction[] = [];
  const reports: string[] = [];
  const io: AgentIO = {
    chat: "main",
    chats: () => [],
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

test("reading a site with no rule asks the user, and reads it in the background once allowed; 'always' leaves a rule", async () => {
  const rules = memoryRules();
  const http = answering({ "http://1.1.1.1/": { status: 200, body: "<p>Hello</p>" } });
  const yes = agentIO({ verdict: "approved", remember: true });
  assert.match(await readForAgent(yes.io, rules, "http://1.1.1.1/", http), /user is asked first/);
  assert.equal(yes.asked[0]?.kind === "ask" && yes.asked[0].action, "Visit");
  await settle();
  assert.match(yes.reports[0] ?? "", /page read[\s\S]*Hello/);
  assert.deepEqual(await rules.sites(), { "1.1.1.1": "ask" });
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

test("a helper holds on the approval and reads on with the page; nothing goes to Muse but that it waits", async () => {
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
