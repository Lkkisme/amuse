import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentAction, AgentIO, Answer } from "@amuse/core";
import type { Permission } from "@amuse/protocol";
import { type Apps, appCall, readable } from "./tools.ts";
import type { Hold } from "./runs.ts";

/** An app whose every action has `permission`, recording what runs and what is remembered. */
function setup(permission: Permission, answer: Answer = { verdict: "approved", remember: false }) {
  const ran: string[] = [];
  const remembered: [string, Permission][] = [];
  const asked: AgentAction[] = [];
  const reports: string[] = [];
  const apps: Apps = {
    accounts: async () => [{ id: "ca_1", label: "me@a.com" }],
    tools: async () => [],
    permission: async () => permission,
    kind: async () => "write",
    remember: async (_, slug, p) => void remembered.push([slug, p]),
    call: async (slug) => (ran.push(slug), { ok: true, data: "done" }),
  };
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
  const run = async () => {
    const told = await appCall(io, apps, "GMAIL_SEND_EMAIL", { to: "x@y.z" }, { summary: "Email x@y.z", reason: "You asked me to write to x" }, undefined);
    await new Promise((r) => setImmediate(r)); // let a background approval settle
    return told;
  };
  const runHeld = (hold: Hold) => appCall(io, apps, "GMAIL_SEND_EMAIL", { to: "x@y.z" }, { summary: "Email x@y.z", reason: "You asked me to write to x" }, undefined, hold);
  return { run, runHeld, ran, remembered, asked, reports };
}

test("denied by the user's rule: a hard no, without a card; the refusal is recorded and the agent is told which rule and where to change it", async () => {
  const s = setup("deny", { verdict: "approved", remember: true });
  const told = await s.run();
  assert.match(told, /^Refused by your rule for Gmail \(Write permissions: Deny\)/);
  assert.match(told, /no card was shown/);
  assert.match(told, /Settings › Connections › Gmail › Write permissions/);
  assert.match(told, /Do not work around it \(another tool, another account, the browser\)/);
  assert.match(told, /do not ask again unless the user brings it up/);
  assert.deepEqual(s.ran, []);
  assert.deepEqual(s.remembered, [], "nothing asked, so nothing to remember");
  assert.deepEqual(s.reports, []);
  // one record, a refusal by the rule: no card
  assert.deepEqual(s.asked, [{ kind: "refuse", action: "Email x@y.z", target: "me@a.com", detail: "Your rule for Gmail (Write permissions: Deny)", app: "gmail" }]);
  // a helper holds on nothing
  const helper = setup("deny");
  const held: string[] = [];
  assert.match(await helper.runHeld({ waiting: (what) => void held.push(what), working: () => void held.push("working") }), /^Refused by your rule/);
  assert.deepEqual(held, []);
  assert.deepEqual(helper.ran, []);
});

test("allowed: it runs at once", async () => {
  const s = setup("allow");
  await s.run();
  assert.deepEqual(s.ran, ["GMAIL_SEND_EMAIL"]);
  assert.deepEqual(s.asked, []);
});

test("asked: it runs only once approved; 'always' is kept as a rule", async () => {
  const declined = setup("ask", { verdict: "denied", remember: false });
  await declined.run();
  assert.deepEqual(declined.ran, []);
  assert.equal(declined.asked[0]?.kind === "ask" && declined.asked[0].remember, true);
  const always = setup("ask", { verdict: "approved", remember: true });
  await always.run();
  assert.deepEqual(always.ran, ["GMAIL_SEND_EMAIL"]);
  assert.deepEqual(always.remembered, [["GMAIL_SEND_EMAIL", "allow"]]);
});

test("asked and not answered in time: nothing runs, and the agent hears why", async () => {
  const s = setup("ask", { verdict: "timed_out", remember: false });
  await s.run();
  assert.deepEqual(s.ran, []);
  assert.match(s.reports[0] ?? "", /did not answer the approval in time/);
});

test("a helper's app action holds until the user answers, then runs and gives the result back to the helper", async () => {
  const s = setup("ask", { verdict: "approved", remember: false });
  const held: string[] = [];
  const told = await s.runHeld({ waiting: (what) => void held.push(what), working: () => void held.push("working") });
  assert.deepEqual(s.ran, ["GMAIL_SEND_EMAIL"]);
  assert.match(told, /done/);
  assert.deepEqual(s.reports, [], "nothing goes to Amuse");
  assert.equal(held.length, 2);
});

test("the card says what will happen in the agent's words, as which account, with the arguments as a person reads them", async () => {
  const s = setup("ask");
  await s.run();
  const card = s.asked[0];
  assert.ok(card?.kind === "ask");
  assert.equal(card.action, "Email x@y.z");
  assert.equal(card.target, "me@a.com");
  assert.equal(card.detail, "You asked me to write to x\n\nTo: x@y.z");
  assert.equal(
    readable({ start_datetime: "2026-10-21T09:00", summary: "测试日程", threadId: "t1", attendees: [], notes: "", count: 2 }),
    "Start datetime: 2026-10-21T09:00\nSummary: 测试日程\nThread id: t1\nCount: 2",
  );
});
