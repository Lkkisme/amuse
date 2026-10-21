import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentAction, AgentIO, Answer } from "@remuse/core";
import type { Permission } from "@remuse/protocol";
import { type Apps, appCall } from "./tools.ts";
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
    remember: async (_, slug, p) => void remembered.push([slug, p]),
    call: async (slug) => (ran.push(slug), { ok: true, data: "done" }),
  };
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
  const run = async () => {
    const told = await appCall(io, apps, "GMAIL_SEND_EMAIL", { to: "x@y.z" }, undefined);
    await new Promise((r) => setImmediate(r)); // let a background approval settle
    return told;
  };
  const runHeld = (hold: Hold) => appCall(io, apps, "GMAIL_SEND_EMAIL", { to: "x@y.z" }, undefined, hold);
  return { run, runHeld, ran, remembered, asked, reports };
}

test("denied: nothing runs and nothing is asked", async () => {
  const s = setup("deny");
  assert.match(await s.run(), /does not allow/);
  assert.deepEqual(s.ran, []);
  assert.deepEqual(s.asked, []);
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
  assert.deepEqual(s.reports, [], "nothing goes to Muse");
  assert.equal(held.length, 2);
});
