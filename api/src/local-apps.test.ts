import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { type AgentAction, type AgentIO, type AppDirectory, memoryRules } from "@amuse/core";
import { appCall, tools, type Apps } from "@amuse/pi";
import { NoComposioKey } from "@amuse/composio";
import { localGitHub } from "./local-github.ts";
import { localApps } from "./local-apps.ts";

function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "amuse-local-apps-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const rules = memoryRules();
  let cloudKey = false;
  let failCloud = false;
  const called: string[] = [];
  const local = localGitHub({ rules, statePath: join(directory, "enabled.json"), connectedUrl: "https://amuse.example.test/", credential: async () => "fixture-token",
    http: (async () => Response.json({ id: 1, login: "fixture", name: null, html_url: "https://github.com/fixture" })) as typeof fetch });
  const cloud = (method: string) => { called.push(method); if (failCloud) throw new Error("cloud-unavailable"); };
  const cloudApps: Apps = {
    async accounts() { cloud("accounts"); return [{ id: "ca_1", label: "Fixture mail" }]; },
    async tools() { cloud("tools"); return []; },
    async permission() { cloud("permission"); return "ask"; },
    async kind() { cloud("kind"); return "write"; },
    async remember() { cloud("remember"); },
    async call() { cloud("call"); return { ok: true, data: "cloud-result" }; },
  };
  const gmail = { id: "gmail", name: "Gmail", description: "Mail", logo: null };
  const cloudDirectory: AppDirectory = {
    async access() { cloud("directory.access"); return { kind: "managed" }; },
    async cannotConnect() { cloud("directory.cannotConnect"); return null; },
    async connectKey() { cloud("directory.connectKey"); },
    async search(_query, cursor) { cloud("search"); return { apps: [gmail], cursor: cursor ? null : "next-page" }; },
    async accounts() { cloud("directory.accounts"); return [{ id: "ca_1", label: "Fixture mail", app: gmail, status: "active", since: null }]; },
    async connect() { cloud("directory.connect"); return "https://accounts.example.test/oauth"; },
    async disconnect() { cloud("disconnect"); },
    async permissions() { cloud("permissions"); return []; },
    async permit() { cloud("permit"); },
  };
  const composite = localApps({ local, cloudApps, cloudDirectory, hasCloudKey: () => cloudKey, cloudConnect: async () => { cloud("connect"); return "https://accounts.example.test/oauth"; } });
  return { local, rules, composite, called, key: (present: boolean) => { cloudKey = present; }, fail: () => { failCloud = true; } };
}

function agent() {
  const actions: AgentAction[] = [];
  const reports: string[] = [];
  let approve = true;
  const io: AgentIO = {
    chat: "main", mention: () => {}, running: () => "", chats: () => [], schedules: () => [], readChat: () => null,
    emit: () => {}, act: (action) => { actions.push(action); return { ok: true, id: "approval-1" }; },
    decision: async () => ({ verdict: approve ? "approved" : "denied", remember: false }),
    report: (note) => { reports.push(note); }, context: () => "", recall: () => "",
    time: () => ({ now: "2026-10-22T00:00:00Z", timezone: "UTC" }), lastWords: () => "",
    answer: async () => ({ kind: "closed" }), listen: () => () => {},
  };
  return { io, actions, reports, decline: () => { approve = false; } };
}

test("without a cloud key the directory shows local GitHub and pending Google apps, never fake Google accounts", async (t) => {
  const { composite, called } = setup(t);
  assert.deepEqual((await composite.directory.search("", null)).apps.map((app) => app.id), ["local-github", "gmail", "googlecalendar"]);
  const calendars = (await composite.directory.search("日历", null)).apps;
  assert.deepEqual(calendars.map((app) => app.id), ["googlecalendar"]);
  assert.equal(calendars[0]?.name, "Google 日历");
  assert.match(calendars[0]!.description, /完成 Google 授权后/);
  const accounts = await composite.directory.accounts();
  assert.deepEqual(accounts.map((account) => account.id), ["local-github:fixture"]);
  assert.deepEqual(called, []);
  await assert.rejects(async () => composite.apps.accounts("gmail"), NoComposioKey);
  await assert.rejects(async () => composite.directory.connect("gmail"), NoComposioKey);
  assert.equal(composite.setup("local-github"), null);
  assert.match(composite.setup("gmail")!, /Composio API key/);
});

test("with a key local and cloud directories combine pages and propagate cloud outages", async (t) => {
  const { composite, key, fail } = setup(t);
  key(true);
  const first = await composite.directory.search("", null);
  assert.deepEqual(first.apps.map((app) => app.id), ["local-github", "gmail"]);
  assert.equal(first.cursor, "next-page");
  assert.deepEqual((await composite.directory.search("", first.cursor)).apps.map((app) => app.id), ["gmail"]);
  assert.deepEqual((await composite.directory.accounts()).map((account) => account.id), ["local-github:fixture", "ca_1"]);
  assert.equal(composite.setup("gmail"), null);
  fail();
  await assert.rejects(() => composite.directory.accounts(), /cloud-unavailable/);
  await assert.rejects(() => composite.directory.search("", null), /cloud-unavailable/);
});

test("app, action and account route explicitly without credential crossover", async (t) => {
  const { composite, called, key } = setup(t);
  assert.equal((await composite.apps.accounts("local-github"))[0]?.id, "local-github:fixture");
  assert.equal((await composite.apps.tools("local-github", "profile"))[0]?.slug, "LOCAL_GITHUB_GET_PROFILE");
  assert.equal(await composite.apps.kind("LOCAL_GITHUB_GET_PROFILE"), "read");
  assert.equal((await composite.apps.call("LOCAL_GITHUB_GET_PROFILE", {}, "local-github:fixture")).ok, true);
  assert.deepEqual(called, []);
  key(true);
  assert.equal((await composite.apps.accounts("gmail"))[0]?.id, "ca_1");
  assert.equal(await composite.apps.kind("GMAIL_SEND_EMAIL"), "write");
  assert.equal((await composite.apps.call("GMAIL_SEND_EMAIL", {}, "ca_1")).ok, true);
  const before = called.length;
  assert.equal((await composite.apps.call("GMAIL_SEND_EMAIL", {}, "local-github:fixture")).ok, false);
  assert.equal((await composite.apps.call("LOCAL_GITHUB_GET_PROFILE", {}, "ca_1")).ok, false);
  await assert.rejects(async () => composite.apps.permission("gmail", "LOCAL_GITHUB_GET_PROFILE"), /different connection/);
  await assert.rejects(async () => composite.apps.remember("local-github", "GMAIL_SEND_EMAIL", "allow"), /different connection/);
  assert.equal(called.length, before);
});

test("the real appCall pipeline identifies local-github and honors allow, deny and per-call approval", async (t) => {
  const { composite, rules, called } = setup(t);
  const s = agent();
  const call = () => appCall(s.io, composite.apps, "LOCAL_GITHUB_GET_PROFILE", {}, { summary: "Read GitHub profile", reason: "You asked to check the connection" }, undefined);
  assert.match(await call(), /fixture/);
  await rules.set("local-github", "read", "deny");
  assert.match(await call(), /Local-github \(Read permissions: Deny\)/);
  const refused = s.actions.at(-1);
  assert.equal(refused?.kind === "refuse" && refused.app, "local-github");
  await rules.set("local-github", "read", "ask");
  assert.match(await call(), /waits for the user's OK/);
  await new Promise((resolve) => setImmediate(resolve));
  const asked = s.actions.at(-1);
  assert.equal(asked?.kind === "ask" && asked.app, "local-github");
  assert.match(s.reports.at(-1)!, /done/);
  s.decline();
  await call();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(s.reports.at(-1)!, /declined/);
  assert.deepEqual(called, []);
});

test("local connection cards settle through the existing login and return the app root, cloud cards retain real OAuth", async (t) => {
  const { composite, called, key } = setup(t);
  const s = agent();
  const connection = { kind: "connection" as const, id: "connection-1", at: "2026-10-22T00:00:00Z", provider: "local-github", title: "GitHub", status: "pending" as const };
  assert.equal(await composite.connect(connection, s.io), "https://amuse.example.test/");
  assert.deepEqual(s.actions, [{ kind: "connected", id: "connection-1" }]);
  assert.match(s.reports[0]!, /existing Git login/);
  assert.deepEqual(called, []);
  await assert.rejects(() => composite.connect({ ...connection, provider: "gmail" }, s.io), NoComposioKey);
  key(true);
  assert.equal(await composite.connect({ ...connection, provider: "gmail" }, s.io), "https://accounts.example.test/oauth");
  assert.equal(called.at(-1), "connect");
  await composite.directory.disconnect("local-github:fixture");
  assert.deepEqual(await composite.apps.accounts("local-github"), []);
  assert.equal(called.at(-1), "connect"); // Local disconnect did not revoke any cloud/Git credential.
});

test("request_connection checks setup for its provider and old zero-argument setup callbacks still work", async (t) => {
  const { composite, rules } = setup(t);
  const s = agent();
  const tool = tools(() => s.io, rules, { appsSetup: composite.setup }).find((entry) => entry.name === "request_connection")!;
  const execute = (provider: string) => tool.execute("fixture", { status: "Connect", provider, title: provider }, undefined, undefined, {} as never);
  assert.doesNotMatch(JSON.stringify(await execute("local-github")), /Composio key goes/);
  assert.match(JSON.stringify(await execute("gmail")), /Composio key goes/);
  const legacy = tools(() => s.io, rules, { appsSetup: () => "legacy setup" }).find((entry) => entry.name === "request_connection")!;
  assert.match(JSON.stringify(await legacy.execute("fixture", { status: "Connect", provider: "gmail", title: "Gmail" }, undefined, undefined, {} as never)), /legacy setup/);
});

test("local access discovery stays managed without a cloud key, and typed keys cannot cross into Git login", async (t) => {
  const { composite, called } = setup(t);
  assert.deepEqual(await composite.directory.access("local-github"), { kind: "managed" });
  assert.equal(await composite.directory.cannotConnect("local-github"), null);
  await assert.rejects(composite.directory.connectKey("local-github", [{ name: "token", value: "must-not-be-stored" }]), /existing Git login/);
  assert.deepEqual(called, []);
  assert.equal((await composite.directory.accounts()).some((account) => account.id === "local-github:fixture"), true, "a refused key flow never disables the existing connection");
  await assert.rejects(async () => composite.directory.access("gmail"), NoComposioKey);
  await assert.rejects(async () => composite.directory.cannotConnect("gmail"), NoComposioKey);
  await assert.rejects(async () => composite.directory.connectKey("gmail", []), NoComposioKey);
  assert.deepEqual(called, []);
});

test("cloud access and key-link capabilities remain routed to their real provider", async (t) => {
  const { composite, called, key } = setup(t); key(true);
  assert.deepEqual(await composite.directory.access("gmail"), { kind: "managed" });
  assert.equal(await composite.directory.cannotConnect("gmail"), null);
  await composite.directory.connectKey("gmail", [{ name: "test-key", value: "fixture" }]);
  assert.deepEqual(called, ["directory.access", "directory.cannotConnect", "directory.connectKey"]);
});
