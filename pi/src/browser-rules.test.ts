import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentAction, type AgentIO, type Answer, type Workspace, memoryRules, noWorkspace } from "@amuse/core";
import { type Notify, type Scene, keepDownloads, permitStep } from "./browser-agent.ts";

/** An agent's IO that records what it asks and answers every approval with `answer` (or never). */
function agentIO(answer: Answer | "never") {
  const acted: AgentAction[] = [];
  const io: AgentIO = {
    chat: "main",
    chats: () => [],
    schedules: () => [],
    readChat: () => null,
    emit: () => {},
    act: (action) => (acted.push(action), { ok: true, id: "a1" }),
    decision: () => (answer === "never" ? new Promise<Answer>(() => {}) : Promise.resolve(answer)),
    report: () => {},
    context: () => "",
    recall: () => "",
    time: () => ({ now: "2026-10-20T08:00:00Z", timezone: "UTC" }),
    lastWords: () => "",
    answer: async () => ({ kind: "closed" }),
    listen: () => () => {},
  };
  return { io, acted };
}

function scene(answer: Answer | "never", url = "https://a5.ucsd.edu/apply") {
  const { io, acted } = agentIO(answer);
  const rules = memoryRules();
  const events: string[] = [];
  const notify: Notify = { waiting: (what) => void events.push(`waiting ${what}`), working: () => void events.push("working") };
  const kept: Record<string, string> = {};
  const workspace: Workspace = {
    ...noWorkspace,
    exists: async (path) => path in kept,
    write: async (path, data) => void (kept[path] = new TextDecoder().decode(data)),
  };
  const base: Scene & { workspace: Workspace; downloaded: string[] } = { io, rules, url, stop: new AbortController(), workspace, downloaded: [] };
  return { base, acted, rules, notify, events, kept };
}
const approved: Answer = { verdict: "approved", remember: false };
const always: Answer = { verdict: "approved", remember: true };
const declined: Answer = { verdict: "denied", remember: false };
const declinedForGood: Answer = { verdict: "denied", remember: true };

test("submit: the default asks; an answer for good records that site and that action; Allow goes ahead; Deny is refused without a card", async () => {
  // Ask (the default): a card, which can be kept for the site as "submit: Allow"
  const ask = scene(always);
  assert.deepEqual(await permitStep(ask.base, ask.notify, "submit", "Send the application", "To a5.ucsd.edu"), { kind: "yes" });
  assert.deepEqual(ask.acted, [{ kind: "ask", action: "Send the application", target: "a5.ucsd.edu", detail: "To a5.ucsd.edu", remember: true }]);
  assert.deepEqual(await ask.rules.sites(), { "a5.ucsd.edu": { never: false, actions: { submit: "allow" } } });
  assert.deepEqual(ask.events, ["waiting Send the application on a5.ucsd.edu: To a5.ucsd.edu", "working"]);
  // once it is allowed for the site, nothing more is asked there
  const again = { ...ask.base, io: agentIO(declined).io };
  assert.deepEqual(await permitStep(again, ask.notify, "submit", "Send it again", "x"), { kind: "yes" });
  // a "no" for good is that action denied for the site
  const no = scene(declinedForGood);
  assert.deepEqual(await permitStep(no.base, no.notify, "submit", "Order", "x"), { kind: "declined" });
  assert.deepEqual(await no.rules.sites(), { "a5.ucsd.edu": { never: false, actions: { submit: "deny" } } });
  // once, or no answer in time: nothing is kept
  const once = scene(declined);
  assert.deepEqual(await permitStep(once.base, once.notify, "submit", "Order", "x"), { kind: "declined" });
  assert.deepEqual(await once.rules.sites(), {});
  const late = scene({ verdict: "timed_out", remember: true });
  assert.deepEqual(await permitStep(late.base, late.notify, "submit", "Order", "x"), { kind: "declined" });
  assert.deepEqual(await late.rules.sites(), {});
  // Allow: no card
  const open = scene(declined);
  await open.rules.setBrowser("submit", "allow");
  assert.deepEqual(await permitStep(open.base, open.notify, "submit", "Order", "x"), { kind: "yes" });
  assert.deepEqual(open.acted, []);
  // Deny: no card, a refusal recorded for the user, the agent told which rule and where
  const deny = scene(approved);
  await deny.rules.setBrowser("submit", "deny");
  const refused = await permitStep(deny.base, deny.notify, "submit", "Send the application", "To a5.ucsd.edu");
  assert.equal(refused.kind, "rule");
  assert.match(
    refused.kind === "rule" ? refused.told : "",
    /^Refused by your setting for submitting forms \(Deny\): submitting forms on a5\.ucsd\.edu is not allowed\. Nothing was asked\.[\s\S]*Settings › Permissions › Browser/,
  );
  assert.deepEqual(deny.acted, [
    { kind: "refuse", action: "Send the application", target: "a5.ucsd.edu", detail: "Your setting for submitting forms (Deny)\nTo a5.ucsd.edu" },
  ]);
  assert.deepEqual(deny.events, []);
  // the nearest site rule beats the setting, a parent's applies to its subdomains
  await deny.rules.setSiteAction("ucsd.edu", "submit", "allow");
  assert.deepEqual(await permitStep(deny.base, deny.notify, "submit", "Send", "x"), { kind: "yes" });
  await deny.rules.setSiteAction("a5.ucsd.edu", "submit", "deny");
  const deeper = await permitStep(deny.base, deny.notify, "submit", "Send", "x");
  assert.match(
    deeper.kind === "rule" ? deeper.told : "",
    /^Refused by your rule for a5\.ucsd\.edu \(submitting forms: Deny\)[\s\S]*Settings › Permissions › a5\.ucsd\.edu/,
  );
  // a site never visited: no step there at all
  await deny.rules.setSiteAction("ucsd.edu", "never", "deny");
  const never = await permitStep(deny.base, deny.notify, "submit", "Send", "x");
  assert.match(never.kind === "rule" ? never.told : "", /^Refused by your rule for ucsd\.edu \(never visit it\)/);
});

test("a run stopped while a card waits is stopped, and leaves no rule", async () => {
  const s = scene("never");
  const waiting = permitStep(s.base, s.notify, "submit", "Order", "x");
  s.base.stop.abort();
  assert.deepEqual(await waiting, { kind: "stopped" });
  assert.deepEqual(await s.rules.sites(), {});
});

test("downloads: kept by default; Deny is not kept and said so; Ask puts a card first; an answer for good is the site's rule", async () => {
  const file = (name: string, text: string) => ({ name, data: new TextEncoder().encode(text) });
  // Allow (the default): kept, never over a file
  const open = scene(declined);
  assert.equal(
    await keepDownloads(open.base, open.notify, [file("bill.pdf", "one"), file("bill.pdf", "two")]),
    "Downloaded and kept for the user: downloads/bill.pdf (3 B), downloads/bill (2).pdf (3 B)\n\n",
  );
  assert.deepEqual(open.kept, { "downloads/bill.pdf": "one", "downloads/bill (2).pdf": "two" });
  assert.deepEqual(open.acted, []);
  assert.deepEqual(open.base.downloaded, ["downloads/bill.pdf", "downloads/bill (2).pdf"]);
  // Deny: not kept, said so with the rule, and every refusal recorded
  const deny = scene(approved);
  await deny.rules.setBrowser("download", "deny");
  const told = await keepDownloads(deny.base, deny.notify, [file("a.zip", "x"), file("b.zip", "y")]);
  assert.match(
    told,
    /^Not kept: a\.zip, b\.zip\. Refused by your setting for downloading files \(Deny\): downloading files from a5\.ucsd\.edu is not allowed\. Nothing was asked\./,
  );
  assert.deepEqual(deny.kept, {});
  assert.deepEqual(deny.base.downloaded, []);
  assert.deepEqual(
    deny.acted.map((a) => a.kind === "refuse" && [a.action, a.target]),
    [
      ["Download a.zip", "a5.ucsd.edu"],
      ["Download b.zip", "a5.ucsd.edu"],
    ],
  );
  // Ask: a card before keeping; declined is not kept
  const ask = scene(declined);
  await ask.rules.setBrowser("download", "ask");
  assert.match(await keepDownloads(ask.base, ask.notify, [file("c.csv", "z")]), /^Not kept \(the user did not approve keeping them\): c\.csv\./);
  assert.equal(ask.acted[0]?.kind === "ask" && ask.acted[0].action, "Download c.csv");
  assert.deepEqual(ask.kept, {});
  // Ask, approved for good: kept, and downloads from this site are kept from now on
  const good = scene(always);
  await good.rules.setBrowser("download", "ask");
  assert.match(await keepDownloads(good.base, good.notify, [file("d.csv", "w")]), /^Downloaded and kept for the user: downloads\/d\.csv/);
  assert.deepEqual(await good.rules.sites(), { "a5.ucsd.edu": { never: false, actions: { download: "allow" } } });
  // a site's own rule beats the setting: denied here, kept elsewhere
  const mixed = scene(declined);
  await mixed.rules.setSiteAction("a5.ucsd.edu", "download", "deny");
  assert.match(
    await keepDownloads(mixed.base, mixed.notify, [file("e.csv", "v")]),
    /^Not kept: e\.csv\. Refused by your rule for a5\.ucsd\.edu \(downloading files: Deny\)/,
  );
  const elsewhere = scene(declined, "https://other.example/");
  await elsewhere.rules.setSiteAction("a5.ucsd.edu", "download", "deny");
  assert.match(await keepDownloads(elsewhere.base, elsewhere.notify, [file("e.csv", "v")]), /^Downloaded and kept/);
  // nowhere to keep them: nothing said
  assert.equal(await keepDownloads({ ...open.base, workspace: undefined }, open.notify, [file("x", "y")]), "");
});

test("uploads: asked every time (never kept as a rule, never allowed); Deny, setting or site, is refused without a card", async () => {
  const ask = scene(always);
  assert.deepEqual(await permitStep(ask.base, ask.notify, "upload", "Upload a file", "user/cv.pdf to a5.ucsd.edu", false), { kind: "yes" });
  assert.deepEqual(ask.acted, [{ kind: "ask", action: "Upload a file", target: "a5.ucsd.edu", detail: "user/cv.pdf to a5.ucsd.edu", remember: false }]);
  assert.deepEqual(await ask.rules.sites(), {}, "an answer for good is not kept for an upload");
  // "Allow" is not a thing for an upload: it still asks
  const allowed = scene(approved);
  await allowed.rules.setBrowser("upload", "allow");
  await permitStep(allowed.base, allowed.notify, "upload", "Upload a file", "x", false);
  assert.equal(allowed.acted[0]?.kind, "ask");
  const deny = scene(approved);
  await deny.rules.setSiteAction("a5.ucsd.edu", "upload", "deny");
  const refused = await permitStep(deny.base, deny.notify, "upload", "Upload a file", "user/cv.pdf to a5.ucsd.edu", false);
  assert.match(
    refused.kind === "rule" ? refused.told : "",
    /^Refused by your rule for a5\.ucsd\.edu \(uploading files: Deny\): uploading files to a5\.ucsd\.edu is not allowed/,
  );
  assert.deepEqual(
    deny.acted.map((a) => a.kind),
    ["refuse"],
  );
});

test("on a page with a trailing dot, the rules for the site apply; for a host no rule can name, 'Always' is not offered", async () => {
  const dotted = scene(declined, "https://a5.ucsd.edu./apply");
  await dotted.rules.setSiteAction("ucsd.edu", "never", "deny");
  const refused = await permitStep(dotted.base, dotted.notify, "submit", "Send", "x");
  assert.match(refused.kind === "rule" ? refused.told : "", /^Refused by your rule for ucsd\.edu \(never visit it\)/);
  const named = scene(always, "https://shop.example./buy");
  await permitStep(named.base, named.notify, "submit", "Order", "x");
  assert.deepEqual(named.acted[0], { kind: "ask", action: "Order", target: "shop.example", detail: "x", remember: true });
  assert.deepEqual(await named.rules.sites(), { "shop.example": { never: false, actions: { submit: "allow" } } });
  // an address or a name no rule can be kept for: asked, with no "Always", and the answer leaves no rule
  for (const url of ["http://[2606:4700::1111]/pay", "https://my_host.example.com/pay"]) {
    const odd = scene(always, url);
    assert.deepEqual(await permitStep(odd.base, odd.notify, "submit", "Order", "x"), { kind: "yes" });
    assert.equal(odd.acted[0]?.kind === "ask" && odd.acted[0].remember, false, url);
    assert.deepEqual(await odd.rules.sites(), {}, url);
  }
  // under the browser's settings: Deny there is refused, naming the setting
  const denied = scene(approved, "http://[2606:4700::1111]/pay");
  await denied.rules.setBrowser("submit", "deny");
  const told = await permitStep(denied.base, denied.notify, "submit", "Order", "x");
  assert.match(told.kind === "rule" ? told.told : "", /^Refused by your setting for submitting forms \(Deny\)/);
});
