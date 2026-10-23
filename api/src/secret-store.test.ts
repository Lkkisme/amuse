import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FieldValue, SecretInput, SecretRequest } from "@amuse/protocol";
import { type SandboxClient, SandboxError, mask } from "@amuse/sandbox";
import { type Db, migratedNow, queryOne } from "@amuse/db";
import { z } from "zod";
import { KeyUnavailable } from "./seal.ts";
import { type SecretStore, secretStore } from "./secret-store.ts";

/** A sandbox that remembers what it holds, as its daemon would. */
function fake(fail?: { on: string }) {
  const env = new Map<string, string>();
  const files = new Map<string, Buffer>();
  const typed: string[] = [];
  const sandbox: SandboxClient = {
    run: async () => ({ output: "", cut: 0, exitCode: 0, signal: null, timedOut: false }),
    reset: async () => {
      env.clear();
      files.clear();
    },
    typeSecret: async ({ pane, value }) => {
      if (fail?.on === "type") throw new SandboxError("Nothing in w1:p2 is waiting for it: the terminal is at its shell prompt.");
      typed.push(`${pane} ${value}`);
    },
    setEnv: async ({ name, value }) => void env.set(name, value),
    setFile: async ({ path, value, encoding }) => void files.set(path, Buffer.from(value, encoding === "base64" ? "base64" : "utf8")),
    forget: async (what) => void ("env" in what ? env.delete(what.env) : files.delete(what.file)),
  };
  return { sandbox, env, files, typed };
}

const line = (text: string): FieldValue => ({ kind: "text", text });
const token = (value: string): SecretInput => ({ name: "token", role: null, value: line(value) });

const TABLES = ["vault_check", "secrets", "secret_plain", "secret_fields", "secret_uses", "secret_claims"];
/** Everything the Vault keeps in the database, as text. */
const dump = (db: Db) => TABLES.map((table) => JSON.stringify(db.prepare(`select * from ${table}`).all())).join("\n");

/** A Vault on a database of its own (every migration run), with its key in a folder apart; `open` is a restart of it. */
function setup(sandbox?: SandboxClient) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-store-"));
  const db = migratedNow(dir);
  const keyPath = join(dir, "keys", "store.key");
  const open = (client: SandboxClient | undefined = sandbox) => secretStore({ db, keyPath, sandbox: client, now: () => "2026-10-23T10:00:00.000Z", warn: () => {} });
  return { dir, db, keyPath, open };
}

const first = async (store: SecretStore) => {
  const entry = (await store.list())[0];
  assert.ok(entry);
  return entry;
};

test("an entry keeps plain fields as they are and secret fields sealed, and lists no secret value", async () => {
  const { dir, db, open } = setup();
  const store = open();
  const { id } = await store.add({
    name: "Cloudflare",
    note: "DNS edit only",
    plain: [{ name: "account id", role: null, value: line("acct-0123") }],
    secret: [token("cf-fake-token-9876-longer")],
    uses: [],
  });
  const [entry] = await store.list();
  assert.equal(entry?.id, id);
  assert.deepEqual(entry?.plain.map((f) => [f.name, f.value]), [["account id", line("acct-0123")]]);
  assert.deepEqual(entry?.secret.map((f) => [f.name, f.hint, f.size]), [["token", "…nger", 25]]);
  assert.doesNotMatch(JSON.stringify(entry), /cf-fake-token/);
  const written = dump(db);
  assert.match(written, /acct-0123/, "plain fields are not encrypted");
  assert.doesNotMatch(written, /cf-fake-token/, "secret fields are");
  // the key is apart from the data, and a restart reads the same
  assert.ok(existsSync(join(dir, "keys", "store.key")));
  assert.equal((await open().list()).length, 1);
});

test("a sandbox use gives the value to the sandbox; a second name for it needs no card; both are taken back", async () => {
  const { sandbox, env, files } = fake();
  const store = setup(sandbox).open();
  const { id } = await store.add({ name: "Cloudflare", note: "", plain: [], secret: [token("cf-fake-token-9876")], uses: [{ kind: "env", field: "token", name: "CF_API_TOKEN" }] });
  assert.equal(env.get("CF_API_TOKEN"), "cf-fake-token-9876");
  const alias = await store.useByAgent({ id, use: { kind: "env", field: "token", name: "CLOUDFLARE_API_TOKEN" } }, false);
  assert.equal(env.get("CLOUDFLARE_API_TOKEN"), "cf-fake-token-9876");
  // a file too
  await store.useByAgent({ id, use: { kind: "file", field: "token", path: "~/.config/cf/token", env: "CF_TOKEN_FILE" } }, false);
  assert.equal(files.get(".config/cf/token")?.toString(), "cf-fake-token-9876");
  assert.equal(env.get("CF_TOKEN_FILE"), "/home/amuse/.config/cf/token", "the variable holds the path, not the secret");
  await store.unuse({ id, use: alias.id });
  assert.equal(env.has("CLOUDFLARE_API_TOKEN"), false);
  await store.remove(id);
  assert.deepEqual([...env.keys(), ...files.keys()], []);
  assert.deepEqual(await store.list(), []);
});

test("a variable or file belongs to one field: a taken one is refused, saying by whom", async () => {
  const store = setup(fake().sandbox).open();
  await store.add({ name: "Cloudflare", note: "", plain: [], secret: [token("cf-fake-token-9876")], uses: [{ kind: "env", field: "token", name: "API_TOKEN" }] });
  await assert.rejects(
    store.add({ name: "OpenAI", note: "", plain: [], secret: [token("sk-fake-0000111122")], uses: [{ kind: "env", field: "token", name: "API_TOKEN" }] }),
    /\$API_TOKEN is already used by Cloudflare token/,
  );
  assert.equal((await store.list()).length, 1, "nothing was half made");
  await assert.rejects(store.add({ name: "cloudflare", note: "", plain: [], secret: [token("sk-fake-0000111122")], uses: [] }), /already an entry called cloudflare/);
});

test("an agent's use of a secret field's first time in the sandbox needs the user's word; a plain field does not", async () => {
  const { sandbox, env } = fake();
  const store = setup(sandbox).open();
  const { id } = await store.add({
    name: "GCP",
    note: "",
    plain: [{ name: "project", role: null, value: line("demo-project") }],
    secret: [token("gcp-fake-token-1234")],
    uses: [],
  });
  await assert.rejects(store.useByAgent({ id, use: { kind: "env", field: "token", name: "GCP_TOKEN" } }, false), /has not been in the sandbox before/);
  assert.equal(env.size, 0);
  await store.useByAgent({ id, use: { kind: "env", field: "project", name: "GCP_PROJECT" } }, false);
  assert.equal(env.get("GCP_PROJECT"), "demo-project");
  await store.useByAgent({ id, use: { kind: "env", field: "token", name: "GCP_TOKEN" } }, true);
  assert.equal(env.get("GCP_TOKEN"), "gcp-fake-token-1234");
  // now it is in the sandbox: a second name needs nothing
  await store.useByAgent({ id, use: { kind: "env", field: "token", name: "GOOGLE_TOKEN" } }, false);
  assert.equal(env.get("GOOGLE_TOKEN"), "gcp-fake-token-1234");
  // a service of the server's is the user's to set up, not an agent's: it needs no card, and is refused for an agent
  await assert.rejects(store.useByAgent({ id, use: { kind: "server", field: "token", service: "model", target: "gcp" } }, true), /variables and files only/);
  await store.use({ id, use: { kind: "server", field: "token", service: "model", target: "gcp" } });
  // editing a plain field in the sandbox puts the new value there
  await store.edit({ id, name: "GCP", note: "", plain: [{ name: "project", role: null, value: line("other-project") }] });
  assert.equal(env.get("GCP_PROJECT"), "other-project");
  await assert.rejects(store.edit({ id, name: "GCP", note: "", plain: [] }), /take that use away first/);
});

test("a key file is stored as bytes, written to the sandbox as a file with its path in a variable, and masked by line and by value", async () => {
  const { sandbox, env, files } = fake();
  const store = setup(sandbox).open();
  const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n";
  const json = JSON.stringify({ type: "service_account", private_key_id: "0123456789abcdef0123", private_key: privateKey }, null, 2);
  const { id } = await store.add({
    name: "Google Cloud",
    note: "",
    plain: [],
    secret: [{ name: "key.json", role: null, value: { kind: "file", filename: "sa.json", content: Buffer.from(json).toString("base64") } }],
    uses: [{ kind: "file", field: "key.json", path: ".config/gcloud/key.json", env: "GOOGLE_APPLICATION_CREDENTIALS" }],
  });
  assert.equal(files.get(".config/gcloud/key.json")?.toString(), json);
  assert.equal(env.get("GOOGLE_APPLICATION_CREDENTIALS"), "/home/amuse/.config/gcloud/key.json");
  const [entry] = await store.list();
  assert.deepEqual(entry?.secret.map((f) => [f.kind, f.filename, f.hint]), [["file", "sa.json", null]]);
  // what a cat prints, or a tool printing a piece of the key, comes back masked
  const label = "Google Cloud";
  const seen = (text: string) => mask(text, store.masked());
  assert.equal(seen(json), `[secret: ${label}]`);
  assert.doesNotMatch(seen(`${json}\n`), /MIIEvQ|0123456789abcdef0123/);
  assert.equal(seen("id: 0123456789abcdef0123."), `id: [secret: ${label}].`);
  assert.doesNotMatch(seen(privateKey), /MIIEvQ/);
  // as an environment variable, a file field goes in as its content, if it is small and text
  await store.use({ id, use: { kind: "env", field: "key.json", name: "KEY_JSON" } });
  assert.equal(env.get("KEY_JSON"), json);
});

test("a file is a line or at most 64 KB, and a binary one reaches the sandbox as its bytes", async () => {
  const { sandbox, files } = fake();
  const store = setup(sandbox).open();
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
  await store.add({
    name: "Keystore",
    note: "",
    plain: [],
    secret: [{ name: "store.p12", role: null, value: { kind: "file", filename: "store.p12", content: bytes.toString("base64") } }],
    uses: [{ kind: "file", field: "store.p12", path: ".keys/store.p12", env: null }],
  });
  assert.deepEqual(files.get(".keys/store.p12"), bytes);
  const entry = await first(store);
  await assert.rejects(store.use({ id: entry.id, use: { kind: "env", field: "store.p12", name: "STORE" } }), /not text/);
});

test("masking covers every secret that is in the sandbox, labelled by entry and field (the entry alone when it has one), and no other", async () => {
  const { sandbox } = fake();
  const store = setup(sandbox).open();
  await store.add({ name: "Site", note: "", plain: [{ name: "username", role: "username", value: line("alexander-the-user") }], secret: [{ name: "password", role: "password", value: line("pw-fake-aaaaaaaa") }, { name: "pin", role: null, value: line("pin-fake-bbbbbbbb") }], uses: [{ kind: "env", field: "password", name: "SITE_PW" }, { kind: "env", field: "pin", name: "SITE_PIN" }] });
  await store.add({ name: "Kept", note: "", plain: [], secret: [token("kept-fake-cccccccc")], uses: [] });
  await store.add({ name: "Solo", note: "", plain: [], secret: [token("solo-fake-dddddddd")], uses: [{ kind: "env", field: "token", name: "SOLO" }] });
  const seen = (text: string) => mask(text, store.masked());
  assert.equal(seen("pw-fake-aaaaaaaa pin-fake-bbbbbbbb solo-fake-dddddddd"), "[secret: Site password] [secret: Site pin] [secret: Solo]");
  assert.equal(seen("kept-fake-cccccccc"), "kept-fake-cccccccc", "not in the sandbox, nothing to mask");
  assert.equal(seen("alexander-the-user"), "alexander-the-user", "plain fields are not masked");
  // replaced: the new value is masked and the old one is not
  const [site] = await store.list();
  assert.ok(site);
  await store.setSecret({ id: site.id, field: { name: "password", role: "password", value: line("pw-fake-eeeeeeee") } });
  assert.equal(seen("pw-fake-aaaaaaaa pw-fake-eeeeeeee"), "[secret: Site password] [secret: Site password]", "the old value stays masked: a program may have kept it");
});

test("a replaced secret goes to the sandbox again, and keeps its last use; the entry keeps one secret at least", async () => {
  const { sandbox, env } = fake();
  const store = setup(sandbox).open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("old-fake-value-1111"), { name: "other", role: null, value: line("other-fake-2222") }], uses: [{ kind: "env", field: "token", name: "API_TOKEN" }] });
  assert.equal((await first(store)).secret[0]?.last?.how, "sandbox");
  await store.setSecret({ id, field: token("new-fake-value-2222") });
  assert.equal(env.get("API_TOKEN"), "new-fake-value-2222");
  assert.equal((await first(store)).secret[0]?.last?.what, "$API_TOKEN");
  await store.removeSecret({ id, name: "other" });
  await assert.rejects(store.removeSecret({ id, name: "token" }), /needs a secret/);
  // removing a secret field takes its uses with it
  await store.setSecret({ id, field: { name: "second", role: null, value: line("second-fake-3333") } });
  await store.use({ id, use: { kind: "env", field: "second", name: "SECOND" } });
  await store.removeSecret({ id, name: "second" });
  assert.equal(env.has("SECOND"), false);
});

test("a use is given again after a reset emptied the sandbox, aliases included", async () => {
  const { sandbox, env, files } = fake();
  const store = setup(sandbox).open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1111")], uses: [{ kind: "env", field: "token", name: "A" }, { kind: "env", field: "token", name: "B" }, { kind: "file", field: "token", path: ".c/t", env: "T" }] });
  await sandbox.reset();
  assert.equal(env.size + files.size, 0);
  await store.again();
  assert.deepEqual([...env.keys()].sort(), ["A", "B", "T"]);
  assert.equal(files.get(".c/t")?.toString(), "api-fake-value-1111");
  assert.ok(id);
});

test("a change the sandbox cannot take is not made: the store stays as it was", async () => {
  const { sandbox } = fake();
  const broken: SandboxClient = { ...sandbox, setEnv: async () => { throw new SandboxError("The sandbox cannot be reached just now: it may be starting, or stopped."); } };
  const store = setup(broken).open();
  await assert.rejects(store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1111")], uses: [{ kind: "env", field: "token", name: "A" }] }), /cannot be reached/);
  assert.deepEqual(await store.list(), []);
  const without = setup().open();
  await assert.rejects(without.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1111")], uses: [{ kind: "env", field: "token", name: "A" }] }), /no sandbox/);
});

test("a temporary code goes into its terminal, is masked for a while in memory, and is written nowhere", async () => {
  const { sandbox, typed } = fake();
  const { dir, open } = setup(sandbox);
  const store = open();
  const request: SecretRequest = { kind: "secret", id: "k-1", at: "2026-10-23T10:00:00.000Z", name: "Login code", why: "the CLI waits", deliver: { kind: "temporary", pane: "w1:p2" }, status: "pending" };
  await store.answer(request, { kind: "temporary", value: "code-fake-837261" });
  assert.deepEqual(typed, ["w1:p2 code-fake-837261"]);
  assert.equal(mask("the terminal shows code-fake-837261", store.masked()), "the terminal shows [secret: temporary code]");
  assert.deepEqual(await store.list(), [], "not listed");
  const everything = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name)).toString("latin1"));
  assert.ok(everything.length >= 2);
  for (const content of everything) assert.doesNotMatch(content, /code-fake-837261/, "never on disk");
  // a terminal at its shell prompt refuses it, in words, and it is not remembered
  const refusing = setup(fake({ on: "type" }).sandbox).open();
  await assert.rejects(refusing.answer(request, { kind: "temporary", value: "code-fake-111111" }), /Nothing in terminal w1:p2 is waiting/);
  assert.equal(mask("code-fake-111111", refusing.masked()), "code-fake-111111");
});

test("a card for a long-term secret stores the fields and sets up the uses written on it", async () => {
  const { sandbox, env } = fake();
  const t = setup(sandbox);
  const store = t.open();
  const request: SecretRequest = {
    kind: "secret",
    id: "k-2",
    at: "2026-10-23T10:00:00.000Z",
    name: "Cloudflare",
    why: "to edit DNS",
    deliver: { kind: "stored", plain: [{ name: "account id", role: null, value: line("acct-1") }], secret: [{ name: "token", kind: "text", role: null }], note: "DNS edit only", uses: [{ kind: "env", field: "token", name: "CF_API_TOKEN" }] },
    status: "pending",
  };
  await store.answer(request, { kind: "stored", secret: [{ name: "token", value: line("cf-fake-token-5555") }] });
  assert.equal(env.get("CF_API_TOKEN"), "cf-fake-token-5555");
  const entry = await first(store);
  assert.equal(entry.note, "DNS edit only");
  assert.equal(entry.uses.length, 1);
  // the plain field is the one Amuse supplied on the card, stored as a plain field (not encrypted); the secret is what the user typed
  assert.deepEqual(entry.plain.map((f) => [f.name, f.value]), [["account id", line("acct-1")]]);
  assert.deepEqual(entry.secret.map((f) => f.name), ["token"]);
  assert.doesNotMatch(dump(t.db), /cf-fake-token-5555/);
  // a second answer for the same name is refused, not merged
  await assert.rejects(store.answer({ ...request, id: "k-3" }, { kind: "stored", secret: [{ name: "token", value: line("cf-fake-token-6666") }] }), /already an entry/);
});

test("a service finds its key by what it serves, records the use at most once a minute, and a sign-in's refresh is not a use", async () => {
  let clock = Date.parse("2026-10-23T10:00:00.000Z");
  const dir = mkdtempSync(join(tmpdir(), "amuse-store-"));
  const store = secretStore({ db: migratedNow(dir), keyPath: join(dir, "k", "store.key"), now: () => new Date(clock).toISOString(), warn: () => {} });
  await store.putService({ name: "OpenAI", managed: false, targets: [{ service: "model", target: "openai" }, { service: "voice", target: "openai" }], bound: "key", plain: [], secret: [{ name: "key", text: "sk-fake-openai-0001" }] });
  assert.equal(store.serviceKey("model", "openai", false)?.values["key"], "sk-fake-openai-0001");
  assert.equal(store.serviceKey("voice", "openai", false)?.values["key"], "sk-fake-openai-0001", "one key, two uses");
  assert.equal(store.serviceKey("model", "groq"), undefined);
  assert.equal((await first(store)).secret[0]?.last, null, "a read that is not a use leaves no mark");
  store.serviceKey("model", "openai");
  await store.list();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const marked = (await first(store)).secret[0]?.last;
  assert.deepEqual(marked, { at: "2026-10-23T10:00:00.000Z", how: "server", what: "openai models" });
  clock += 10_000;
  store.serviceKey("model", "openai");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await first(store)).secret[0]?.last?.at, "2026-10-23T10:00:00.000Z", "not written again within a minute");
  assert.deepEqual(store.serviceSecrets(), ["sk-fake-openai-0001"]);
  // a target belongs to one entry
  await store.putService({ name: "OpenAI", managed: false, targets: [{ service: "model", target: "openai" }], bound: "key", plain: [], secret: [{ name: "key", text: "sk-fake-openai-0002" }] });
  assert.equal((await store.list()).length, 1, "changed in place");
  assert.equal(store.serviceKey("model", "openai", false)?.values["key"], "sk-fake-openai-0002");
  await store.dropService("model", "openai");
  assert.deepEqual(await store.list(), []);
});

test("an entry the system keeps can be removed but not changed", async () => {
  const store = setup(fake().sandbox).open();
  await store.putService({
    name: "OpenAI sign-in",
    managed: true,
    targets: [{ service: "model", target: "openai" }],
    bound: "access",
    plain: [{ name: "expires", text: "1777777777000" }],
    secret: [{ name: "access", text: "acc-fake-0001" }, { name: "refresh", text: "ref-fake-0001" }],
  });
  const entry = await first(store);
  assert.equal(entry.managed, true);
  await assert.rejects(store.edit({ id: entry.id, name: "x", note: "", plain: [] }), /kept by Amuse/);
  await assert.rejects(store.setSecret({ id: entry.id, field: token("new-fake-value") }), /kept by Amuse/);
  await assert.rejects(store.use({ id: entry.id, use: { kind: "env", field: "access", name: "TOK" } }), /kept by Amuse/);
  await store.remove(entry.id);
  assert.deepEqual(await store.list(), []);
});

test("a store whose key is gone refuses to open, and makes no new one", async () => {
  const { dir, keyPath, open } = setup();
  const store = open();
  await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1111")], uses: [] });
  const gone = join(dir, "moved.key");
  renameSync(keyPath, gone);
  assert.throws(() => open(), (e: unknown) => e instanceof KeyUnavailable && e.trouble === "missing" && /key file .* is missing/.test(e.message));
  assert.equal(existsSync(keyPath), false);
});

/** A sandbox whose calls can be made to fail, and that lets a test look at the store while a value is on its way. */
function breaking(fail: (call: string) => boolean, during?: (call: string) => void) {
  const { sandbox, env, files } = fake();
  const guarded = <A extends unknown[], R>(name: string, call: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    during?.(name);
    if (fail(name)) throw new SandboxError("The sandbox could not do that (500).");
    return call(...args);
  };
  const broken: SandboxClient = { ...sandbox, setEnv: guarded("setEnv", sandbox.setEnv), setFile: guarded("setFile", sandbox.setFile), forget: guarded("forget", sandbox.forget) };
  return { sandbox: broken, env, files };
}

test("a delivery that fails halfway is taken back: nothing stays in the sandbox that the store does not hold, and nothing in it goes unmasked", async () => {
  let calls = 0;
  const seen: string[] = [];
  let store: SecretStore | undefined;
  const { sandbox, env, files } = breaking(
    (name) => name === "setFile" && ++calls === 1,
    () => seen.push(mask("echo cf-fake-token-9876-longer", store?.masked() ?? [])),
  );
  store = setup(sandbox).open();
  await assert.rejects(
    store.add({ name: "Stripe", note: "", plain: [], secret: [token("cf-fake-token-9876-longer")], uses: [{ kind: "env", field: "token", name: "STRIPE" }, { kind: "file", field: "token", path: ".config/stripe/key", env: null }] }),
    /could not do that/,
  );
  assert.deepEqual(await store.list(), [], "no entry");
  assert.equal(env.has("STRIPE"), false, "the variable that had gone out is taken back");
  assert.equal(files.size, 0);
  // while it was on its way, what the sandbox printed of it was masked
  assert.ok(seen.length >= 2 && seen.every((text) => text === "echo [secret: Stripe]"), seen.join("|"));
  // and it stays masked: what was on its way may have left a trace (a file a program wrote, a terminal's history)
  assert.equal(mask("cf-fake-token-9876-longer", store.masked()), "[secret: Stripe]");
});

test("a file with a variable for its path whose variable cannot be set leaves neither the file nor the variable", async () => {
  const { sandbox, env, files } = breaking((name) => name === "setEnv");
  const store = setup(sandbox).open();
  await assert.rejects(
    store.add({ name: "GCP", note: "", plain: [], secret: [token("gcp-fake-token-0123456789")], uses: [{ kind: "file", field: "token", path: ".config/gcp/key", env: "GOOGLE_APPLICATION_CREDENTIALS" }] }),
    /could not do that/,
  );
  assert.equal(files.size, 0, "the file is taken back");
  assert.equal(env.size, 0);
  assert.deepEqual(await store.list(), []);
});

test("a replaced secret whose second use fails goes back to what it was, in the sandbox and in the store", async () => {
  let fail = false;
  let sets = 0;
  const { sandbox, env } = breaking((name) => fail && name === "setEnv" && ++sets === 2);
  const store = setup(sandbox).open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("old-fake-value-aaaaaaaaaaaa")], uses: [{ kind: "env", field: "token", name: "FIRST" }, { kind: "env", field: "token", name: "SECOND" }] });
  fail = true;
  await assert.rejects(store.setSecret({ id, field: token("new-fake-value-bbbbbbbbbbbb") }), /could not do that/);
  assert.equal(env.get("FIRST"), "old-fake-value-aaaaaaaaaaaa", "the first is back to the old value");
  assert.equal(env.get("SECOND"), "old-fake-value-aaaaaaaaaaaa");
  assert.equal(mask("new-fake-value-bbbbbbbbbbbb old-fake-value-aaaaaaaaaaaa", store.masked()), "[secret: API] [secret: API]", "the value that was going out stays masked too");
  assert.equal((await first(store)).secret[0]?.hint, "…aaaa");
});

test("a path in the workspace is refused up front, in every spelling, before a card or the sandbox is asked", async () => {
  const { sandbox, env, files } = fake();
  const store = setup(sandbox).open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1234567890")], uses: [] });
  for (const path of ["workspace/x", "~/workspace/x", "/home/amuse/workspace/x", "./workspace/./x", "workspace", "workspace//x", "a/../workspace/x", "/etc/passwd", "../x", "~"]) {
    await assert.rejects(store.use({ id, use: { kind: "file", field: "token", path, env: "P" } }), /(home folder|not a file)/, path);
  }
  assert.equal(env.size + files.size, 0);
  await assert.rejects(store.add({ name: "Other", note: "", plain: [], secret: [token("api-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "STRIPE" }, { kind: "file", field: "token", path: "workspace/x", env: null }] }), /home folder/);
  assert.equal(env.has("STRIPE"), false, "nothing went out before the bad path was found");
});

test("with no sandbox, an entry with variables and files can still be removed, and its uses and fields taken away", async () => {
  const { sandbox } = fake();
  const t = setup(sandbox);
  const store = t.open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1234567890"), { name: "two", role: null, value: line("two-fake-value-1234567890") }], uses: [{ kind: "env", field: "token", name: "A" }, { kind: "file", field: "two", path: ".c/two", env: "B" }] });
  const offline = t.open(undefined);
  const [entry] = await offline.list();
  assert.equal(entry?.uses.length, 2);
  await offline.unuse({ id, use: entry?.uses[0]?.id ?? "" });
  await offline.removeSecret({ id, name: "two" });
  assert.deepEqual((await offline.list())[0]?.uses, []);
  await offline.remove(id);
  assert.deepEqual(await offline.list(), []);
});

test("a re-delivery after a reset waits for the changes before it, and a removal made meanwhile is not undone by it", async () => {
  const { sandbox, env } = fake();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let slow = false;
  const slowing: SandboxClient = { ...sandbox, setEnv: async (secret) => { if (slow) await held; await sandbox.setEnv(secret); } };
  const store = setup(slowing).open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "A" }] });
  await sandbox.reset();
  slow = true;
  const again = store.again();
  const removing = store.remove(id);
  release();
  await Promise.all([again, removing]);
  assert.equal(env.has("A"), false, "the removal came last");
  assert.deepEqual(await store.list(), []);
});

test("a secret whose text has quotes or backslashes is masked as the sandbox's own JSON file of variables shows it; a temporary code too", async () => {
  const { sandbox } = fake();
  const store = setup(sandbox).open();
  const value = 'pa"ss\\word-fake-0123456789';
  await store.add({ name: "Odd", note: "", plain: [], secret: [token(value)], uses: [{ kind: "env", field: "token", name: "ODD" }] });
  const asJson = JSON.stringify({ ODD: value });
  assert.equal(mask(asJson, store.masked()), '{"ODD":"[secret: Odd]"}');
  assert.equal(mask(`export ODD=${value}`, store.masked()), "export ODD=[secret: Odd]");
  const request: SecretRequest = { kind: "secret", id: "k-9", at: "2026-10-23T10:00:00.000Z", name: "Code", why: "x", deliver: { kind: "temporary", pane: "w1:p2" }, status: "pending" };
  await store.answer(request, { kind: "temporary", value: 'co"de\\-fake-998877' });
  assert.equal(mask(JSON.stringify({ code: 'co"de\\-fake-998877' }), store.masked()), '{"code":"[secret: temporary code]"}');
});

/** The sealed value of the first field of entry `a` and of entry `b`, each put where the other's was. */
function swapSealed(db: Db, a: string, b: string) {
  const sealed = (name: string) => queryOne(db, z.object({ sealed: z.string(), entry: z.string() }), "select f.sealed as sealed, f.entry as entry from secret_fields f join secrets s on s.id = f.entry where s.name = ?", name);
  const x = sealed(a);
  const y = sealed(b);
  assert.ok(x && y);
  db.prepare("update secret_fields set sealed = ? where entry = ?").run(y.sealed, x.entry);
  db.prepare("update secret_fields set sealed = ? where entry = ?").run(x.sealed, y.entry);
}

test("a secret that cannot be opened while it is in the sandbox is not guessed at: what the sandbox printed is withheld", async () => {
  const { sandbox } = fake();
  const t = setup(sandbox);
  const store = t.open();
  await store.add({ name: "One", note: "", plain: [], secret: [token("one-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "ONE" }] });
  await store.add({ name: "Two", note: "", plain: [], secret: [token("two-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "TWO" }] });
  // as if one sealed value had been swapped for another's: it opens for neither
  swapSealed(t.db, "One", "Two");
  const damaged = t.open();
  assert.throws(() => damaged.masked(), (e: unknown) => e instanceof SandboxError && /withheld/.test(e.message) && !/fake-value/.test(e.message));
  // and through the sandbox the agent sees, the run is refused, not let through unmasked
  const { masking } = await import("@amuse/sandbox");
  const seen = masking({ ...sandbox, run: async () => ({ output: "ONE=one-fake-value-1234567890\n", cut: 0, exitCode: 0, signal: null, timedOut: false }) }, () => damaged.masked());
  await assert.rejects(seen.run({ command: "env" }), (e: unknown) => e instanceof SandboxError && /withheld/.test(e.message));
});

test("a key of the right size that is not the store's is found at the start: the store is not opened, and nothing is changed", async () => {
  const t = setup();
  const store = t.open();
  await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1234567890")], uses: [] });
  const before = dump(t.db);
  const key = readFileSync(t.keyPath);
  writeFileSync(t.keyPath, Buffer.alloc(32, 7));
  assert.throws(() => t.open(), (e: unknown) => e instanceof KeyUnavailable && e.trouble === "wrong" && /is not the key its secrets were sealed with/.test(e.message));
  assert.equal(dump(t.db), before);
  // the right key opens it again
  writeFileSync(t.keyPath, key);
  assert.equal((await t.open().list()).length, 1);
  // an empty store has the check too: its key is not changed without notice
  const empty = setup();
  empty.open();
  writeFileSync(empty.keyPath, Buffer.alloc(32, 9));
  assert.throws(() => empty.open(), /is not the key/);
});

test("the end of a secret is shown only for a long one: a short one shows no characters, just that it is set", async () => {
  const store = setup().open();
  await store.add({ name: "Short", note: "", plain: [], secret: [token("short-fake-12345678")], uses: [] });
  await store.add({ name: "Long", note: "", plain: [], secret: [token("long-fake-value-123456789")], uses: [] });
  const [short, long] = await store.list();
  assert.equal(short?.secret[0]?.hint, null);
  assert.equal(long?.secret[0]?.hint, "…6789");
});

test("a service has one key: a second entry for the same service is refused, saying which has it; a key that cannot be read is no key", async () => {
  const warnings: string[] = [];
  const t = setup();
  const dir = t.dir;
  const store = secretStore({ db: t.db, keyPath: t.keyPath, warn: (m) => void warnings.push(m) });
  await store.putService({ name: "OpenAI", managed: false, targets: [{ service: "model", target: "openai" }, { service: "voice", target: "openai" }], bound: "key", plain: [], secret: [{ name: "key", text: "sk-fake-openai-0123456789" }] });
  await store.add({ name: "Mine", note: "", plain: [], secret: [token("mine-fake-value-1234567890")], uses: [] });
  const mine = (await store.list())[1];
  assert.ok(mine);
  await assert.rejects(store.use({ id: mine.id, use: { kind: "server", field: "token", service: "model", target: "openai" } }), /already used by OpenAI key/);
  await assert.rejects(
    store.putService({ name: "Other", managed: false, targets: [{ service: "model", target: "groq" }, { service: "voice", target: "openai" }], bound: "key", plain: [], secret: [{ name: "key", text: "gk-fake-0123456789012" }] }),
    /openai speech to text is served by OpenAI already/,
  );
  assert.equal((await store.list()).length, 2, "nothing was made by the refused one");
  // its sealed value swapped out: it cannot be read, so there is no key (and a word about it, with no value)
  swapSealed(t.db, "OpenAI", "Mine");
  const damaged = secretStore({ db: t.db, keyPath: t.keyPath, warn: (m) => void warnings.push(m) });
  assert.equal(damaged.serviceKey("model", "openai"), undefined);
  assert.match(warnings.join("\n"), /could not be read from the Vault, so it is treated as missing/);
  assert.doesNotMatch(warnings.join("\n"), /fake/);
  assert.ok(dir);
});

test("a card cannot ask for a service of Amuse's own: only variables and files", async () => {
  const store = setup(fake().sandbox).open();
  const request: SecretRequest = {
    kind: "secret",
    id: "k-5",
    at: "2026-10-23T10:00:00.000Z",
    name: "Sneaky",
    why: "x",
    deliver: { kind: "stored", plain: [], secret: [{ name: "key", kind: "text", role: null }], note: "", uses: [{ kind: "server", field: "key", service: "model", target: "openai" }] },
    status: "pending",
  };
  await assert.rejects(store.answer(request, { kind: "stored", secret: [{ name: "key", value: line("sneaky-fake-value-1234567890") }] }), /variables and files only/);
  assert.deepEqual(await store.list(), []);
});

test("a change is written to the tables whole or not at all, and the database refuses the same variable, file or name twice", async () => {
  const { sandbox } = fake();
  const t = setup(sandbox);
  const store = t.open();
  await store.add({ name: "Mine", note: "", plain: [], secret: [token("mine-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "MINE" }] });
  const before = dump(t.db);
  // a write that fails halfway (the uses' table refuses) leaves no half of an entry, in the tables or in what the Vault holds
  const flaky = new Proxy(t.db, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === "prepare") return (sql: string) => (sql.startsWith("insert into secret_uses") ? { run: () => { throw new Error("disk full"); } } : target.prepare(sql));
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const failing = secretStore({ db: flaky, keyPath: t.keyPath, sandbox, warn: () => {} });
  await assert.rejects(failing.add({ name: "Other", note: "", plain: [], secret: [token("other-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "OTHER" }] }), /disk full/);
  assert.equal(dump(t.db), before);
  assert.equal((await failing.list()).length, 1);
  // and what the sandbox had been given for it is taken back
  assert.equal(mask("other-fake-value-1234567890", failing.masked()), "[secret: Other]", "and what had been given for it stays masked");
  // the database's own constraints
  assert.throws(() => t.db.prepare("insert into secret_claims (claim, use) values ('env MINE', (select id from secret_uses limit 1))").run(), /UNIQUE|constraint/);
  assert.throws(() => t.db.prepare("insert into secrets (id, name, managed, note, created) values ('x', 'MINE', 0, '', 'now')").run().changes && t.db.prepare("insert into secrets (id, name, managed, note, created) values ('y', 'mine', 0, '', 'now')").run(), /UNIQUE|constraint/);
});

test("a secret removed while the sandbox cannot be reached is removed all the same, stays masked, and is taken out of the sandbox when it can be", async () => {
  const { sandbox, env, files } = fake();
  let reachable = true;
  const warnings: string[] = [];
  const flaky: SandboxClient = { ...sandbox, forget: async (what) => { if (!reachable) throw new SandboxError("The sandbox cannot be reached just now: it may be starting, or stopped."); return sandbox.forget(what); } };
  const t = setup(flaky);
  const store = secretStore({ db: t.db, keyPath: t.keyPath, sandbox: flaky, warn: (m) => void warnings.push(m) });
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("api-fake-value-1234567890")], uses: [{ kind: "env", field: "token", name: "API_TOKEN" }, { kind: "file", field: "token", path: ".c/api", env: "API_PATH" }] });
  assert.equal(env.get("API_TOKEN"), "api-fake-value-1234567890");
  reachable = false;
  await store.remove(id);
  assert.deepEqual(await store.list(), [], "removed");
  assert.equal(env.get("API_TOKEN"), "api-fake-value-1234567890", "still in the sandbox, which could not be told");
  assert.equal(mask("see api-fake-value-1234567890", store.masked()), "see [secret: API]", "so it stays masked");
  assert.match(warnings.join("\n"), /could not be told to forget \$API_TOKEN just now.*taken out the next time the sandbox is reached, and masked until then/);
  assert.doesNotMatch(warnings.join("\n"), /api-fake-value/);
  const waiting = t.db.prepare("select kind, target from sandbox_cleanup order by kind, target").all();
  assert.deepEqual(waiting.map((r) => `${r["kind"]} ${r["target"]}`), ["env API_PATH", "env API_TOKEN", "file .c/api"]);
  // a sweep while it is still out of reach changes nothing; once it is back, what was left goes
  await store.sweep();
  assert.equal(env.size, 2);
  reachable = true;
  // a restart of the server: the Vault is opened again, and sweeps
  const restarted = secretStore({ db: t.db, keyPath: t.keyPath, sandbox: flaky, warn: () => {} });
  await restarted.sweep();
  assert.deepEqual([...env.keys(), ...files.keys()], []);
  assert.equal(t.db.prepare("select count(*) as n from sandbox_cleanup").get()?.["n"], 0);
});

test("a value that was replaced or removed stays masked until the sandbox's home is emptied, and not after", async () => {
  const { sandbox } = fake();
  const store = setup(sandbox).open();
  const { id } = await store.add({ name: "API", note: "", plain: [], secret: [token("old-fake-value-1234567890"), { name: "two", role: null, value: line("two-fake-value-1234567890") }], uses: [{ kind: "env", field: "token", name: "A" }, { kind: "env", field: "two", name: "B" }] });
  const seen = (text: string) => mask(text, store.masked());
  await store.setSecret({ id, field: token("new-fake-value-1234567890") });
  assert.equal(seen("old-fake-value-1234567890 new-fake-value-1234567890"), "[secret: API token] [secret: API token]");
  const entry = await first(store);
  const second = entry.uses.find((u) => u.field === "two");
  assert.ok(second);
  await store.unuse({ id, use: second.id });
  assert.equal(seen("two-fake-value-1234567890"), "[secret: API two]", "a use taken away: the value may still be in what ran");
  await store.removeSecret({ id, name: "two" });
  await store.remove(id);
  assert.equal(seen("new-fake-value-1234567890"), "[secret: API]", "an entry removed");
  // the home is emptied: there is nothing left for them to mask
  await store.again();
  assert.equal(seen("old-fake-value-1234567890 new-fake-value-1234567890 two-fake-value-1234567890"), "old-fake-value-1234567890 new-fake-value-1234567890 two-fake-value-1234567890");
});
