import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentAction, type AgentIO, type AgentSecrets, type Answer, type Keys, noKeys } from "@amuse/core";
import type { KeyProvider, SecretEntry, Use, UseInput } from "@amuse/protocol";
import type { Hold } from "./runs.ts";
import { listing, secretActions, secretTools } from "./secrets.ts";

const entry = (over: Partial<SecretEntry> = {}): SecretEntry => ({
  id: "e-1",
  name: "Cloudflare",
  managed: false,
  plain: [{ name: "account id", role: null, value: { kind: "text", text: "acct-0123" } }],
  secret: [{ name: "token", role: null, kind: "text", filename: null, size: 20, hint: "…9876", last: null }],
  note: "DNS edit only",
  uses: [],
  created: "2026-10-23T00:00:00Z",
  ...over,
});

const providers: KeyProvider[] = [
  { id: "openai", name: "OpenAI", use: "models", connected: true, way: "key", hint: "…abcd", account: { name: "OpenAI (ChatGPT)", subscription: true }, guide: null },
  { id: "openrouter", name: "OpenRouter", use: "models", connected: false, way: null, hint: null, account: null, guide: null },
  { id: "composio", name: "Composio", use: "apps", connected: false, way: null, hint: null, account: null, guide: null },
];

function setup(entries: SecretEntry[] = [], answer: Answer | Promise<Answer> = { verdict: "approved", remember: false }, hold?: Hold) {
  const acted: AgentAction[] = [];
  const reports: string[] = [];
  const applied: { use: UseInput; approved: boolean }[] = [];
  const secrets: AgentSecrets = {
    list: async () => entries,
    useByAgent: async ({ use }, approved) => {
      applied.push({ use, approved });
      return { ...use, id: "u-new" } satisfies Use;
    },
  };
  const io: AgentIO = {
    chat: "main",
    chats: () => [],
    schedules: () => [],
    readChat: () => null,
    emit: () => {},
    act: (action) => (acted.push(action), { ok: true, id: "k-1" }),
    decision: async () => answer,
    report: (note) => void reports.push(note),
    context: () => "",
    recall: () => "",
    time: () => ({ now: "2026-10-23T08:00:00Z", timezone: "UTC" }),
    lastWords: () => "",
    answer: async () => ({ kind: "closed" }),
    listen: () => () => {},
  };
  const keys: Pick<Keys, "list"> = { list: async () => ({ ...(await noKeys.list()), providers }) };
  const act = secretActions({ secrets, keys, sandbox: true }, () => io, hold);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { act, acted, reports, applied, settle };
}

test("the listing shows names, plain values, secret field names and uses, and never a secret's value or hint", () => {
  const text = listing([
    entry({ uses: [{ id: "u1", kind: "env", field: "token", name: "CF_API_TOKEN" }, { id: "u2", kind: "server", field: "token", service: "model", target: "cf" }] }),
    entry({ id: "e-2", name: "GCP", plain: [], secret: [{ name: "key.json", role: null, kind: "file", filename: "sa.json", size: 2380, hint: null, last: null }], note: "" }),
  ]);
  assert.match(text, /- Cloudflare\n  note: DNS edit only\n  plain fields:\n    account id = acct-0123/);
  assert.match(text, /secret fields \(you never see their values\):\n    token\n/);
  assert.match(text, /\$CF_API_TOKEN \(token\)/);
  assert.match(text, /for Amuse's own use, never in the sandbox: cf models/);
  assert.match(text, /key.json \(a file, sa.json\)/);
  assert.doesNotMatch(text, /9876/, "not even a hint");
});

test("a temporary code is asked with a card for its terminal, and only for a terminal", async () => {
  const s = setup();
  const told = await s.act.request({ name: "Claude login code", why: "the CLI waits for it", pane: "w1:p2" });
  assert.match(told, /^Asked on a card/);
  assert.deepEqual(s.acted, [{ kind: "askSecret", name: "Claude login code", why: "the CLI waits for it", deliver: { kind: "temporary", pane: "w1:p2" } }]);
  assert.match(await s.act.request({ name: "x", why: "y", pane: "not a pane" }), /not a pane's id/);
  assert.equal(s.acted.length, 1);
});

test("a long-term secret is asked with its fields, note and uses; a name that exists, a taken variable, or a bad one is said, not asked", async () => {
  const s = setup([entry({ uses: [{ id: "u1", kind: "env", field: "token", name: "CF_API_TOKEN" }] })]);
  const told = await s.act.request({
    name: "OpenAI",
    why: "to run scripts",
    secret: [{ name: "key" }],
    plain: [{ name: "organization", value: "org-fake-77" }],
    note: "project key",
    uses: [{ field: "key", env: "OPENAI_API_KEY" }],
  });
  assert.match(told, /^Asked on a card/);
  assert.deepEqual(s.acted, [
    {
      kind: "askSecret",
      name: "OpenAI",
      why: "to run scripts",
      deliver: {
        kind: "stored",
        plain: [{ name: "organization", role: null, value: { kind: "text", text: "org-fake-77" } }],
        secret: [{ name: "key", kind: "text", role: null }],
        note: "project key",
        uses: [{ kind: "env", field: "key", name: "OPENAI_API_KEY" }],
      },
    },
  ]);
  assert.match(await s.act.request({ name: "cloudflare", why: "y", secret: [{ name: "token" }] }), /there is an entry called cloudflare already/);
  assert.match(await s.act.request({ name: "Other", why: "y", secret: [{ name: "token" }], uses: [{ field: "token", env: "CF_API_TOKEN" }] }), /\$CF_API_TOKEN is already used by Cloudflare token/);
  assert.match(await s.act.request({ name: "Other", why: "y", secret: [{ name: "token" }], uses: [{ field: "token", env: "lower" }] }), /not a variable's name/);
  assert.match(await s.act.request({ name: "Other", why: "y", secret: [{ name: "token" }], uses: [{ field: "nope", env: "X" }] }), /no field called nope/);
  assert.match(await s.act.request({ name: "Other", why: "y", secret: [{ name: "token" }, { name: "Token" }] }), /name of its own/);
  assert.match(await s.act.request({ name: "Other", why: "y", pane: "w1:p2", secret: [{ name: "token" }] }), /exactly one/);
  assert.equal(s.acted.length, 1);
});

test("a key file is asked as a file field, with the file and a variable for its path", async () => {
  const s = setup();
  await s.act.request({ name: "Google Cloud", why: "to deploy", secret: [{ name: "key.json", kind: "file" }], uses: [{ field: "key.json", file: ".config/gcloud/key.json", path_env: "GOOGLE_APPLICATION_CREDENTIALS" }] });
  assert.deepEqual(s.acted[0], {
    kind: "askSecret",
    name: "Google Cloud",
    why: "to deploy",
    deliver: {
      kind: "stored",
      plain: [],
      secret: [{ name: "key.json", kind: "file", role: null }],
      note: "",
      uses: [{ kind: "file", field: "key.json", path: ".config/gcloud/key.json", env: "GOOGLE_APPLICATION_CREDENTIALS" }],
    },
  });
});

test("the key of one of Amuse's own services: a card for a missing one; nothing when it is set up; the valid ids when it is unknown", async () => {
  const s = setup();
  const told = await s.act.request({ why: "to use OpenRouter models", provider: "openrouter" });
  assert.match(told, /^Asked on a card/);
  assert.deepEqual(s.acted, [{ kind: "askSecret", name: "OpenRouter", why: "to use OpenRouter models", deliver: { kind: "key", provider: "openrouter", hint: null } }]);
  assert.match(await s.act.request({ why: "connections", provider: "composio" }), /^Asked on a card/);
  assert.equal(s.acted.length, 2);

  assert.match(await s.act.request({ why: "x", provider: "openai" }), /^Nothing asked: the key of OpenAI is set up already/);
  assert.match(await s.act.request({ why: "x", provider: "nonesuch" }), /nonesuch is not a provider or app that takes a key\. The ids are: openai, openrouter, composio\./);
  assert.equal(s.acted.length, 2, "nothing more was posted");
});

test("a secret field's first time in the sandbox waits for a card (Allow or Deny, no once) and is done only when allowed", async () => {
  let allow: (answer: Answer) => void = () => {};
  const s = setup([entry()], new Promise<Answer>((resolve) => (allow = resolve)));
  const told = await s.act.use({ entry: "cloudflare", field: "token", why: "to edit DNS from scripts", env: "CF_API_TOKEN" });
  assert.match(told, /^NOT done yet: it waits for the user's OK/);
  const card = s.acted[0];
  assert.ok(card && card.kind === "ask");
  assert.equal(card.action, "Put a secret in the sandbox");
  assert.equal(card.lasting, true);
  assert.equal(card.remember, false);
  assert.match(card.detail ?? "", /Programs in the sandbox, Amuse included, can read it/);
  await s.settle();
  assert.deepEqual(s.applied, [], "not before the answer");
  allow({ verdict: "approved", remember: false });
  await s.settle();
  assert.deepEqual(s.applied, [{ use: { kind: "env", field: "token", name: "CF_API_TOKEN" }, approved: true }]);
  assert.match(s.reports.join("\n"), /Done: Cloudflare token is in the sandbox as \$CF_API_TOKEN/);
});

test("declined, nothing is put in the sandbox; the agent is told not to find another way", async () => {
  const s = setup([entry()], { verdict: "denied", remember: false });
  await s.act.use({ entry: "Cloudflare", field: "token", why: "x", env: "CF_API_TOKEN" });
  await s.settle();
  assert.deepEqual(s.applied, []);
  assert.match(s.reports.join("\n"), /did not allow Cloudflare token into the sandbox\. Do not try another way/);
});

test("a plain field, and a second name for a secret already in the sandbox, are done at once with no card", async () => {
  const inSandbox = entry({ uses: [{ id: "u1", kind: "env", field: "token", name: "CF_API_TOKEN" }] });
  const s = setup([inSandbox]);
  assert.match(await s.act.use({ entry: "Cloudflare", field: "account id", why: "x", env: "CF_ACCOUNT_ID" }), /^Done: Cloudflare account id is in the sandbox as \$CF_ACCOUNT_ID/);
  assert.match(await s.act.use({ entry: "Cloudflare", field: "token", why: "x", env: "CLOUDFLARE_API_TOKEN" }), /^Done/);
  assert.deepEqual(s.acted, [], "no card");
  assert.deepEqual(s.applied.map((a) => a.approved), [false, false]);
});

test("a helper holds on the card until the user answers, then goes on with the result", async () => {
  const steps: string[] = [];
  const hold: Hold = { waiting: (what) => void steps.push(`waiting ${what}`), working: () => void steps.push("working") };
  const allowed = setup([entry()], { verdict: "approved", remember: false }, hold);
  assert.match(await allowed.act.use({ entry: "Cloudflare", field: "token", why: "x", env: "CF_API_TOKEN" }), /^Done: Cloudflare token is in the sandbox/);
  assert.deepEqual(steps, ["waiting to put Cloudflare token in the sandbox", "working"]);
  assert.deepEqual(allowed.reports, [], "it tells its own run, not the chat");
  const declined = setup([entry()], { verdict: "denied", remember: false }, hold);
  assert.match(await declined.act.use({ entry: "Cloudflare", field: "token", why: "x", env: "CF_API_TOKEN" }), /^Not done: the user declined it\. Do not try another way/);
  assert.deepEqual(declined.applied, []);
});

test("a taken name, a missing entry, a missing field or no place are said, and no card is shown", async () => {
  const s = setup([entry({ uses: [{ id: "u1", kind: "env", field: "account id", name: "TAKEN" }] })]);
  assert.match(await s.act.use({ entry: "Cloudflare", field: "token", why: "x", env: "TAKEN" }), /^Not done: \$TAKEN is already used by Cloudflare account id/);
  assert.match(await s.act.use({ entry: "Nope", field: "token", why: "x", env: "X" }), /no entry called Nope/);
  assert.match(await s.act.use({ entry: "Cloudflare", field: "nope", why: "x", env: "X" }), /no field called nope/);
  assert.match(await s.act.use({ entry: "Cloudflare", field: "token", why: "x" }), /Say where token goes/);
  assert.deepEqual(s.acted, []);
});

test("a request whose file would go in the workspace is refused before a card is shown, and so is a use of one", async () => {
  const s = setup([entry()]);
  assert.match(await s.act.request({ name: "Stripe", why: "x", secret: [{ name: "key" }], uses: [{ field: "key", env: "STRIPE" }, { field: "key", file: "workspace/stripe.key" }] }), /^Not asked: .*not a file in the sandbox's home folder/);
  assert.deepEqual(s.acted, []);
  assert.match(await s.act.use({ entry: "Cloudflare", field: "account id", why: "x", file: "~/workspace/id" }), /^Not done: .*not a file in the sandbox's home folder/);
  assert.deepEqual(s.applied, []);
});

test("the plain fields of a request are the agent's, with their values: a card has none to type; a value that is not a line is said, not asked", async () => {
  const s = setup();
  const told = await s.act.request({ name: "Site", why: "to log in", plain: [{ name: "username", value: " wyb " }, { name: "account id", value: "acct-1" }], secret: [{ name: "password" }] });
  assert.match(told, /^Asked on a card/);
  assert.match(told, /They type only the secret fields/);
  const card = s.acted[0];
  assert.ok(card && card.kind === "askSecret" && card.deliver.kind === "stored");
  assert.deepEqual(card.deliver.plain, [
    { name: "username", role: null, value: { kind: "text", text: "wyb" } },
    { name: "account id", role: null, value: { kind: "text", text: "acct-1" } },
  ]);
  assert.deepEqual(card.deliver.secret, [{ name: "password", kind: "text", role: null }]);
  // no value, a value of two lines: not asked
  assert.match(await s.act.request({ name: "Other", why: "x", plain: [{ name: "username", value: "" }], secret: [{ name: "password" }] }), /^Not asked: the value of username is a line of text/);
  assert.match(await s.act.request({ name: "Other", why: "x", plain: [{ name: "note", value: "a\nb" }], secret: [{ name: "password" }] }), /^Not asked: the value of note is a line of text/);
  assert.equal(s.acted.length, 1);
});

test("the agent's Vault tools can look and put to use, and have no way to show a secret's value", () => {
  const secrets: AgentSecrets = {
    list: async () => [],
    useByAgent: async () => {
      throw new Error("unused");
    },
  };
  const io = (): AgentIO => {
    throw new Error("listing the tools needs no chat");
  };
  const names = secretTools(io, { secrets, sandbox: true }).map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => /reveal|show|read|copy/.test(name)), []);
  assert.ok(names.includes("list_secrets"));
});
