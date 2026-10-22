import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { memoryRules } from "@amuse/core";
import { gitCredential, isLocalGitHubAccount, isLocalGitHubAction, localGitHub, LOCAL_GITHUB_APP } from "./local-github.ts";

const token = "fixture-secret-never-to-be-returned";
const profile = { id: 42, login: "fixture-user", name: "Fixture", html_url: "https://github.com/fixture-user", email: "private@example.test", ignored_token: token };
const repository = { id: 9, name: "fixture", full_name: "fixture-user/fixture", private: true, html_url: "https://github.com/fixture-user/fixture", description: null, default_branch: "main", archived: false, updated_at: "2026-10-22T00:00:00Z", ignored_token: token };
const issue = { number: 7, title: "Fixture issue", state: "open", html_url: "https://github.com/fixture-user/fixture/issues/7", body: "An issue body", user: { login: "fixture-user", email: "hidden@example.test" }, updated_at: "2026-10-22T00:00:00Z" };
const pull = { ...issue, html_url: "https://github.com/fixture-user/fixture/pull/7", head: { ref: "feature", repo: { token } }, base: { ref: "main" }, draft: false, merged_at: null };

function setup(t: TestContext, route?: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const directory = mkdtempSync(join(tmpdir(), "amuse-local-github-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, "enabled.json");
  const rules = memoryRules();
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  let credentials = 0;
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/user") return Response.json(profile);
    return route?.(url, init) ?? Response.json([]);
  }) as typeof fetch;
  const local = localGitHub({ statePath, rules, credential: async () => { credentials++; return token; }, http, connectedUrl: "https://amuse.example.test/connected" });
  return { local, statePath, rules, calls, directory, credentials: () => credentials };
}

test("local GitHub account and action identifiers are distinct from cloud GitHub", () => {
  assert.equal(isLocalGitHubAccount("local-github:fixture-user"), true);
  assert.equal(isLocalGitHubAccount("ca_cloud"), false);
  assert.equal(isLocalGitHubAction("LOCAL_GITHUB_GET_PROFILE"), true);
  assert.equal(isLocalGitHubAction("GITHUB_GET_PROFILE"), false);
});

test("account discovery uses existing credential in memory and strips private profile fields", async (t) => {
  const { local, statePath, calls } = setup(t);
  assert.deepEqual(await local.apps.accounts(LOCAL_GITHUB_APP), [{ id: "local-github:fixture-user", label: "fixture-user" }]);
  assert.deepEqual(await local.status(), { enabled: true, connected: true, login: "fixture-user", reason: null });
  const result = await local.apps.call("LOCAL_GITHUB_GET_PROFILE", {}, "local-github:fixture-user");
  assert.deepEqual(result, { ok: true, data: { id: 42, login: "fixture-user", name: "Fixture", html_url: "https://github.com/fixture-user" } });
  assert.doesNotMatch(JSON.stringify(result), /secret|private@example/);
  assert.equal(calls[0]!.init?.method, "GET");
  assert.equal(calls[0]!.init?.redirect, "error");
  assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), `Bearer ${token}`);
  // Reading this connection does not create a credential or configuration file.
  assert.throws(() => readFileSync(statePath));
});

test("directory lists the local connection without a Composio key and supports search", async (t) => {
  const { local } = setup(t);
  assert.equal((await local.directory.search("GitHub", null)).apps[0]?.id, LOCAL_GITHUB_APP);
  assert.deepEqual(await local.directory.search("gmail", null), { apps: [], cursor: null });
  assert.deepEqual(await local.directory.search("", "next"), { apps: [], cursor: null });
  assert.equal((await local.directory.accounts())[0]?.status, "active");
  assert.equal((await local.apps.tools(LOCAL_GITHUB_APP, "" )).length, 6);
  assert.equal((await local.apps.tools(LOCAL_GITHUB_APP, "pull requests"))[0]?.slug.includes("PULL_REQUEST"), true);
});

test("repository, issue and pull request reads use validated fixed GitHub paths and pagination", async (t) => {
  const { local, calls } = setup(t, (url) => {
    if (url.pathname === "/user/repos") return Response.json([repository]);
    if (url.pathname.endsWith("/issues/7")) return Response.json(issue);
    if (url.pathname.endsWith("/issues")) return Response.json([issue, { ...issue, number: 8, pull_request: { url: "https://api.github.com/repos/fixture-user/fixture/pulls/8" } }]);
    if (url.pathname.endsWith("/pulls/7")) return Response.json(pull);
    if (url.pathname.endsWith("/pulls")) return Response.json([pull]);
    return new Response(null, { status: 404 });
  });
  const account = "local-github:fixture-user";
  const repos = await local.apps.call("LOCAL_GITHUB_LIST_REPOSITORIES", { page: 2, per_page: 5 }, account);
  assert.equal(repos.ok, true);
  assert.doesNotMatch(JSON.stringify(repos), /ignored_token|secret/);
  const repoRead = calls.find((call) => call.url.pathname === "/user/repos")!;
  assert.equal(repoRead.url.searchParams.get("page"), "2");
  assert.equal(repoRead.url.searchParams.get("per_page"), "5");
  assert.equal(repoRead.url.searchParams.get("sort"), "updated");
  const args = { owner: "fixture-user", repo: "fixture" };
  const issues = await local.apps.call("LOCAL_GITHUB_LIST_ISSUES", { ...args, state: "all" }, account);
  assert.deepEqual(issues.ok ? (issues.data as { is_pull_request: boolean }[]).map((entry) => entry.is_pull_request) : [], [false, true]);
  assert.doesNotMatch(JSON.stringify(issues), /hidden@example/);
  assert.equal((await local.apps.call("LOCAL_GITHUB_GET_ISSUE", { ...args, number: 7 }, account)).ok, true);
  const pulls = await local.apps.call("LOCAL_GITHUB_LIST_PULL_REQUESTS", args, account);
  assert.equal(pulls.ok, true);
  assert.doesNotMatch(JSON.stringify(pulls), /secret|"repo"/);
  assert.equal((await local.apps.call("LOCAL_GITHUB_GET_PULL_REQUEST", { ...args, number: 7 }, account)).ok, true);
  for (const call of calls) { assert.equal(call.url.origin, "https://api.github.com"); assert.equal(call.init?.method, "GET"); }
});

test("read rules survive discovery and a denied read never reaches the network", async (t) => {
  const { local, rules, calls, credentials } = setup(t);
  await rules.set(LOCAL_GITHUB_APP, "read", "deny");
  assert.equal((await local.apps.tools(LOCAL_GITHUB_APP, "profile"))[0]?.permission, "deny");
  assert.equal(await local.apps.permission(LOCAL_GITHUB_APP, "LOCAL_GITHUB_GET_PROFILE"), "deny");
  assert.equal(await local.apps.kind("LOCAL_GITHUB_GET_PROFILE"), "read");
  const denied = await local.apps.call("LOCAL_GITHUB_GET_PROFILE", {}, "local-github:fixture-user");
  assert.equal(denied.ok, false);
  assert.match(denied.ok ? "" : denied.error, /Read permissions rule denies/);
  assert.equal(calls.length, 0);
  assert.equal(credentials(), 0);
  await local.apps.remember(LOCAL_GITHUB_APP, "LOCAL_GITHUB_GET_PROFILE", "ask");
  assert.equal(await local.apps.permission(LOCAL_GITHUB_APP, "LOCAL_GITHUB_GET_PROFILE"), "ask");
  await local.directory.permit(LOCAL_GITHUB_APP, "read", "allow");
  assert.equal(await local.apps.permission(LOCAL_GITHUB_APP, "LOCAL_GITHUB_GET_PROFILE"), "allow");
});

test("disconnect persists only an Amuse switch and reconnect verifies the existing login", async (t) => {
  const { local, statePath, calls, credentials } = setup(t);
  await local.directory.disconnect("local-github:fixture-user");
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), { version: 1, enabled: false });
  assert.equal(credentials(), 0);
  assert.deepEqual(await local.apps.accounts(LOCAL_GITHUB_APP), []);
  const result = await local.apps.call("LOCAL_GITHUB_GET_PROFILE", {}, "local-github:fixture-user");
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
  assert.equal(await local.directory.connect(LOCAL_GITHUB_APP), "https://amuse.example.test/connected");
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), { version: 1, enabled: true });
  assert.doesNotMatch(readFileSync(statePath, "utf8"), /secret|password|fixture-user/);
  assert.equal((await local.apps.accounts(LOCAL_GITHUB_APP)).length, 1);
});

test("invalid actions, paths, extra fields and account mismatch cannot become arbitrary HTTP calls", async (t) => {
  const { local, calls, credentials } = setup(t);
  const bad = [
    ["LOCAL_GITHUB_DELETE_REPOSITORY", {}],
    ["LOCAL_GITHUB_GET_PROFILE", { url: "https://other.example/steal" }],
    ["LOCAL_GITHUB_GET_ISSUE", { owner: "../elsewhere", repo: "repo", number: 1 }],
    ["LOCAL_GITHUB_GET_ISSUE", { owner: "owner", repo: "..", number: 1 }],
    ["LOCAL_GITHUB_GET_ISSUE", { owner: "owner", repo: "repo", number: -1 }],
    ["LOCAL_GITHUB_LIST_REPOSITORIES", { per_page: 1000 }],
  ] as const;
  for (const [slug, args] of bad) assert.equal((await local.apps.call(slug, args, "local-github:fixture-user")).ok, false);
  assert.equal(credentials(), 0);
  assert.equal(calls.length, 0);
  const wrong = await local.apps.call("LOCAL_GITHUB_LIST_REPOSITORIES", {}, "local-github:another-user");
  assert.equal(wrong.ok, false);
  assert.equal(calls.length, 1); // Only identity lookup; no repository access.
  await assert.rejects(() => local.apps.accounts("github"), /local-github/);
  await assert.rejects(() => local.directory.disconnect("ca_cloud"), /not a local GitHub/);
});

test("bad responses and credential errors never return raw server bodies, diagnostics or tokens", async (t) => {
  const { local } = setup(t, () => new Response(`upstream private error ${token}`, { status: 403 }));
  const failed = await local.apps.call("LOCAL_GITHUB_LIST_REPOSITORIES", {}, "local-github:fixture-user");
  assert.deepEqual(failed, { ok: false, error: "GitHub returned HTTP 403." });
  const { local: invalid } = setup(t, () => Response.json({ secret: token }));
  assert.deepEqual(await invalid.apps.call("LOCAL_GITHUB_LIST_REPOSITORIES", {}, "local-github:fixture-user"), { ok: false, error: "GitHub returned an unexpected response format." });
  const credentials = localGitHub({ statePath: join(tmpdir(), `no-state-${crypto.randomUUID()}.json`), rules: memoryRules(), credential: async () => { throw new Error(token); } });
  assert.doesNotMatch(JSON.stringify(await credentials.status()), /secret/);
  assert.doesNotMatch(JSON.stringify(await credentials.apps.call("LOCAL_GITHUB_GET_PROFILE", {}, "local-github:fixture-user")), /secret/);
});

test("an oversized response is stopped rather than loaded unbounded", async (t) => {
  const { local } = setup(t, () => new Response("x".repeat(4_000_001)));
  const result = await local.apps.call("LOCAL_GITHUB_LIST_REPOSITORIES", {}, "local-github:fixture-user");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /too much data/);
});

test("credential helper runs without UI and passes no secret in process arguments", async (t) => {
  const { directory } = setup(t);
  writeFileSync(join(directory, "credential"), `let input='';process.stdin.on('data',p=>input+=p);process.stdin.on('end',()=>{if(process.argv[2]!=='fill'||process.env.GCM_INTERACTIVE!=='Never'||process.env.GIT_TERMINAL_PROMPT!=='0'||input!=='protocol=https\\nhost=github.com\\n\\n'){process.exit(3)}process.stdout.write('username=fixture\\npassword=${token}\\n\\n')});`);
  assert.equal(await gitCredential({ executable: process.execPath, cwd: directory }), token);
  writeFileSync(join(directory, "credential"), `process.stderr.write('${token}');process.exit(4);`);
  await assert.rejects(() => gitCredential({ executable: process.execPath, cwd: directory }), (error: Error) => !error.message.includes(token) && error.message.includes("No existing GitHub"));
});
