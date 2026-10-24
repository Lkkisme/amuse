/**
 * The rule: no secret value can be read back through Amuse, ever. Amuse's own browser could open Amuse's web app and
 * read whatever a method returns, so the server returns hints (the end of a line, a file's name and size) and never
 * a secret field's value, or the content of a secret file. This walks every method that has to do with secrets, and
 * the views a client builds its screens from, with known fake values, and finds none in any answer.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AgentIO, type Timers, createHost } from "@amuse/core";
import { demoPorts } from "@amuse/demo";
import { migratedNow } from "@amuse/db";
import { memoryChoices, piKeys, storeCredentials } from "@amuse/pi";
import { Call, type FieldValue, type Method } from "@amuse/protocol";
import type { JobState, SandboxClient } from "@amuse/sandbox";
import { secretStore } from "./secret-store.ts";

const instant: Timers<number> = { set: (_, fn) => (queueMicrotask(fn), 0), clear: () => {} };
const never: Timers<number> = { set: () => 0, clear: () => {} };

const idle: JobState = { id: "j1", running: false, seconds: 0, output: "", cut: 0, end: { exitCode: 0, signal: null, reason: "finished" } };
const sandbox: SandboxClient = {
  run: async () => ({ output: "", cut: 0, exitCode: 0, signal: null, timedOut: false }),
  start: async () => idle,
  jobOutput: async () => idle,
  stopJobs: async () => [],
  waitJob: async () => idle,
  reset: async () => {},
  typeSecret: async () => {},
  setEnv: async () => {},
  setFile: async () => {},
  forget: async () => {},
};

/** Every value this test gives as a secret, in every form it could come back in. */
const TOKEN = "tok-fake-readback-aaaa7777";
const REPLACED = "tok-fake-readback-bbbb8888";
const CODE = "code-fake-readback-123456";
const KEY_JSON = JSON.stringify({ private_key_id: "0123456789abcdef0123", private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n" }, null, 2);
const COMPOSIO = "ak_fake_readback_cccc9999";
const FORBIDDEN = [
  TOKEN,
  REPLACED,
  CODE,
  KEY_JSON,
  Buffer.from(KEY_JSON).toString("base64"),
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
  "0123456789abcdef0123",
  COMPOSIO,
];

/** The one method that gives a secret's value back: the user's own reveal, behind the PIN (sensitive.ts). */
const REVEALS = ["secrets.reveal"];

const isSecretsMethod = (method: string) => method.startsWith("secret");

test("no method of the protocol that has to do with secrets, and no view of them, returns a secret's value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-readback-"));
  const store = secretStore({ db: migratedNow(dir), keyPath: join(dir, "k", "store.key"), sandbox, warn: () => {} });
  const keys = piKeys({
    keys: storeCredentials(store, { apps: ["composio"] }),
    choices: memoryChoices(),
    apps: [{ id: "composio", name: "Composio", message: "Your key", where: "Somewhere.", link: { url: "https://composio.dev/", label: "composio.dev" } }],
  });
  let agent: AgentIO | undefined;
  const ports = { ...demoPorts(instant), secrets: store, keys, prompt: (_: unknown, io: AgentIO) => void (agent = io) };
  const host = createHost(ports, { timers: never });

  /** Everything any call answers, as text. */
  const answers: string[] = [];
  const called = new Set<string>();
  const call: typeof host.call = async (method, params) => {
    called.add(method);
    const answer = await host.call(method, params);
    if (!REVEALS.includes(method)) answers.push(`${method}: ${JSON.stringify(answer)}`);
    return answer;
  };

  const text = (value: string): FieldValue => ({ kind: "text", text: value });
  const { id } = await call("secrets.add", {
    name: "Readback",
    note: "a note",
    plain: [{ name: "account id", role: null, value: text("STORED-FIELD-VALUE-FAKE") }],
    secret: [
      { name: "token", role: null, value: text(TOKEN) },
      { name: "key.json", role: null, value: { kind: "file", filename: "key.json", content: Buffer.from(KEY_JSON).toString("base64") } },
    ],
    uses: [{ kind: "env", field: "token", name: "READBACK_TOKEN" }],
  });
  await call("secrets.list", {});
  await call("secrets.edit", { id, name: "Readback", note: "another note", plain: [{ name: "account id", role: null, value: text("STORED-FIELD-VALUE-FAKE") }] });
  const { use } = await call("secrets.use", { id, use: { kind: "file", field: "key.json", path: ".config/readback/key.json", env: "READBACK_KEY_PATH" } });
  await call("secrets.setSecret", { id, field: { name: "token", role: null, value: text(REPLACED) } });
  // the reveal gives that one value and nothing more, and the views after it still do not
  assert.deepEqual(await call("secrets.reveal", { id, field: "token" }), { value: REPLACED });
  await call("secrets.list", {});
  await call("secrets.unuse", { id, use: use.id });
  await call("secrets.removeSecret", { id, name: "key.json" });

  // cards: a temporary code, and a long-term secret, answered
  await call("chat.send", { chat: "main", text: "hi", timezone: "UTC", attachments: [] });
  assert.ok(agent);
  const temporary = agent.act({ kind: "askSecret", name: "Login code", why: "a CLI waits", deliver: { kind: "temporary", pane: "w1:p2" } });
  const stored = agent.act({
    kind: "askSecret",
    name: "Stored by card",
    why: "to test",
    deliver: { kind: "stored", plain: [], secret: [{ name: "token", kind: "text", role: null }], note: "", uses: [{ kind: "env", field: "token", name: "CARD_TOKEN" }] },
  });
  assert.ok(temporary.ok && stored.ok);
  await call("secret.answer", { id: temporary.id, answer: { kind: "temporary", value: CODE } });
  await call("secret.answer", { id: stored.id, answer: { kind: "stored", secret: [{ name: "token", value: text(TOKEN) }] } });
  // a key's card, and the key added through the sign-in
  const wanted = agent.act({ kind: "askSecret", name: "Composio", why: "connections", deliver: { kind: "key", provider: "composio", hint: null } });
  assert.ok(wanted.ok);
  const step = await call("keys.login", { provider: "composio" });
  assert.equal(step.kind, "prompt");
  if (step.kind === "prompt") await call("keys.answer", { login: step.login, value: COMPOSIO });
  await call("keys.list", {});
  await call("secrets.remove", { id });

  // what a client builds its screens from
  await call("session.sync", { chat: "main", since: null });
  await call("session.history", { chat: "main", before: 1000, limit: 200 });
  await call("approvals.list", {});

  // only the reveal is let off the walk, and nothing else answers with a value
  assert.deepEqual(REVEALS.filter((method) => !called.has(method)), []);

  // every method about secrets was walked: a new one fails here until it is added to the walk
  const methods = Call.options.map((option) => option.shape.method.value).filter(isSecretsMethod);
  const missed: Method[] = methods.filter((method) => !called.has(method));
  assert.deepEqual(missed, [], "a method about secrets was not walked");

  for (const answer of answers) for (const value of FORBIDDEN) assert.ok(!answer.includes(value), `a secret value came back in ${answer.slice(0, 40)}`);
  // and the views show only hints and sizes
  const list = answers.filter((a) => a.startsWith("secrets.list")).join("\n");
  assert.match(list, /"hint":"…8888"/);
  assert.match(list, /STORED-FIELD-VALUE-FAKE/, "a plain field is there to read");
  assert.match(list, /"filename":"key.json"/);
  // the secret really was kept: the walk found nothing because nothing is returned, not because nothing was stored
  const kept = store.serviceKey("apps", "composio", false);
  assert.equal(kept?.values["key"], COMPOSIO);
});

test("the settings list and an entry's view give a secret field's hint, or a file's name and size, and a plain field its value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-readback-"));
  const store = secretStore({ db: migratedNow(dir), keyPath: join(dir, "k", "store.key"), sandbox, warn: () => {} });
  await store.add({
    name: "View",
    note: "visible note",
    plain: [{ name: "username", role: "username", value: { kind: "text", text: "visible-user" } }],
    secret: [
      { name: "password", role: "password", value: { kind: "text", text: TOKEN } },
      { name: "key.json", role: null, value: { kind: "file", filename: "sa.json", content: Buffer.from(KEY_JSON).toString("base64") } },
    ],
    uses: [],
  });
  const [entry] = await store.list();
  assert.ok(entry);
  assert.deepEqual(entry.plain, [{ name: "username", role: "username", value: { kind: "text", text: "visible-user" } }]);
  assert.equal(entry.note, "visible note");
  assert.deepEqual(
    entry.secret.map(({ name, kind, filename, size, hint }) => ({ name, kind, filename, size, hint })),
    [
      { name: "password", kind: "text", filename: null, size: TOKEN.length, hint: "…7777" },
      { name: "key.json", kind: "file", filename: "sa.json", size: KEY_JSON.length, hint: null },
    ],
  );
  const shown = JSON.stringify(entry);
  for (const value of FORBIDDEN) assert.ok(!shown.includes(value));
});
