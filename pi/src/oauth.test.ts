import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { type OAuthAuth, type OAuthCredential, type Provider, envApiKeyAuth } from "@earendil-works/pi-ai";
import type { ServiceKey, ServiceStore, ServiceWrite } from "@amuse/core";
import { storeCredentials } from "./credentials.ts";
import { memoryChoices, piKeys } from "./keys.ts";
import { runtime } from "./session.ts";

/** A provider of Pi's, but with a sign-in of the test's own, so no account is ever signed in to. */
function fake(id: string, oauth: OAuthAuth): Provider {
  return {
    id,
    name: `Fake ${id}`,
    auth: { apiKey: envApiKeyAuth(`${id} API key`, ["FAKE_OAUTH_TEST_API_KEY"]), oauth },
    getModels: () => [],
    stream: () => {
      throw new Error("offline");
    },
    streamSimple: () => {
      throw new Error("offline");
    },
  };
}

/** When the tokens the fake providers hand out expire: an hour from the test run's start, so a test can name the moment. */
const EXPIRES = Date.now() + 3_600_000;

const tokens = (n: number): OAuthCredential => ({ type: "oauth", access: `access_secret_${n}`, refresh: `refresh_secret_${n}`, expires: EXPIRES, accountId: "acct-1" });

/**
 * The Vault as far as Pi's credentials need it, in memory: one entry for each service, written whole as
 * `ServiceWrite` says (api/src/secret-store.ts is the real one, behind the same interface). Nothing goes to a
 * file, so a test can look at exactly what a sign-in leaves in the Vault, and read it back as after a restart.
 */
function vault() {
  const kept = new Map<string, ServiceWrite>();
  const find = (service: string, target: string) => [...kept.entries()].find(([, write]) => write.targets.some((t) => t.service === service && t.target === target));
  const store: ServiceStore = {
    serviceKey(service, target) {
      const found = find(service, target);
      if (!found) return undefined;
      const [id, write] = found;
      const entry: ServiceKey["entry"] = { id, name: write.name, managed: write.managed, plain: [], secret: [], note: "", uses: [], created: "" };
      return { entry, field: write.bound, values: Object.fromEntries([...write.plain, ...write.secret].map((f) => [f.name, f.text])) };
    },
    serviceTargets: () => [...kept.values()].flatMap((write) => write.targets),
    async putService(write) {
      const first = write.targets[0];
      const before = first && find(first.service, first.target);
      kept.set(before?.[0] ?? `e-${kept.size + 1}`, write);
    },
    async dropService(service, target) {
      const found = find(service, target);
      if (found) kept.delete(found[0]);
    },
    serviceSecrets: () => [...kept.values()].flatMap((write) => write.secret.map((f) => f.text)),
  };
  return { store, kept };
}

async function setup(providers: Provider[]) {
  const { store, kept } = vault();
  const file = storeCredentials(store);
  const models = await runtime({ auth: { kind: "keys", keys: file } });
  for (const p of providers) models.registerNativeProvider(p);
  return { store, kept, file, models, keys: piKeys({ keys: file, choices: memoryChoices() }) };
}

test("signing in with an account: the provider's page, then the address it ends on pasted back; the tokens are a Vault entry", async () => {
  const seen: { device: string | undefined; agent: string | undefined } = { device: undefined, agent: undefined };
  const chat = fake("fake-chat", {
    name: "Fake (ChatGPT subscription)",
    isSubscription: true,
    async login(interaction, options) {
      seen.device = options?.getDeviceId?.();
      seen.agent = options?.agentName;
      interaction.notify({ type: "progress", message: "Listening for OAuth callback on http://127.0.0.1:1455" });
      interaction.notify({ type: "auth_url", url: "https://auth.example.com/authorize?state=s1" });
      const pasted = await interaction.prompt({ type: "manual_code", message: "Paste the final redirect URL", placeholder: "http://127.0.0.1:1455/auth/callback" });
      assert.equal(new URL(pasted).searchParams.get("code"), "c1");
      return tokens(1);
    },
    refresh: async () => tokens(2),
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { keys, kept, file } = await setup([chat]);
  const listed = (await keys.list()).providers.find((p) => p.id === "fake-chat");
  assert.deepEqual(listed?.account, { name: "Fake (ChatGPT subscription)", subscription: true });
  assert.equal(listed?.way, null);

  const first = await keys.login("fake-chat", "account");
  assert.equal(first.kind, "prompt");
  if (first.kind !== "prompt") return;
  assert.equal(first.prompt.type, "address");
  assert.equal(first.page, "https://auth.example.com/authorize?state=s1");
  assert.deepEqual(first.notes, [], "Pi's own progress is said in the app's words instead");
  assert.deepEqual(await keys.answer(first.login, "  http://127.0.0.1:1455/auth/callback?code=c1&state=s1 \n"), { kind: "done" });

  // this instance registers with a UUID of its own, and says who it is
  assert.match(seen.device ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(seen.agent, "Amuse");

  const after = await keys.list();
  const signedIn = after.providers.find((p) => p.id === "fake-chat");
  assert.equal(signedIn?.connected, true);
  assert.equal(signedIn?.way, "account");
  assert.equal(signedIn?.hint, null, "a sign-in shows no end of a token");
  assert.ok(!JSON.stringify(after).includes("secret"), "no token comes back");

  // what the sign-in left in the Vault: the tokens are secret fields, the expiry and the account id plain
  const entry = [...kept.values()][0];
  assert.equal(entry?.name, "fake-chat");
  assert.equal(entry?.managed, true, "a sign-in is Amuse's to keep: the user may remove it, which signs out, and not edit it");
  assert.deepEqual(entry?.targets, [{ service: "model", target: "fake-chat" }], "the use that finds it is the provider's models");
  assert.equal(entry?.bound, "access", "the field the use is for");
  assert.deepEqual(entry?.secret, [
    { name: "access", text: "access_secret_1" },
    { name: "refresh", text: "refresh_secret_1" },
  ]);
  assert.deepEqual(entry?.plain, [
    { name: "expires", text: String(EXPIRES) },
    { name: "accountId", text: "acct-1" },
  ]);
  // errors leave the tokens out
  assert.deepEqual(file.secrets(), ["access_secret_1", "refresh_secret_1"]);

  // signing out removes the entry
  await keys.logout("fake-chat");
  assert.equal(kept.size, 0, "the entry goes with the sign-out");
  assert.deepEqual(file.secrets(), [], "and nothing of the tokens is left to leave out of an error");
  assert.equal((await keys.list()).providers.find((p) => p.id === "fake-chat")?.way, null);

  // this instance's own id was made once and kept (the choice it is kept in): signing in again uses the same one
  const made = seen.device;
  const again = await keys.login("fake-chat", "account");
  if (again.kind !== "prompt") return assert.fail("expected a prompt");
  assert.equal(seen.device, made, "the installation's id is the one kept, not a new one");
  await keys.cancel(again.login);
});

test("a way of signing in meant for another machine is chosen for the user, and its code is asked for", async () => {
  const claude = fake("fake-claude", {
    name: "Fake (Claude Pro/Max)",
    isSubscription: true,
    async login(interaction) {
      const method = await interaction.prompt({ type: "select", message: "Select login method:", options: [{ id: "browser", label: "Browser" }, { id: "copy_code", label: "Copy code" }] });
      assert.equal(method, "copy_code");
      interaction.notify({ type: "auth_url", url: "https://claude.example.com/oauth/authorize" });
      const code = await interaction.prompt({ type: "manual_code", message: "Paste the code", placeholder: "code#state" });
      assert.equal(code, "abc#def");
      return tokens(1);
    },
    refresh: async () => tokens(2),
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { keys } = await setup([claude]);
  const first = await keys.login("fake-claude", "account");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  assert.equal(first.prompt.type, "code");
  assert.equal(first.page, "https://claude.example.com/oauth/authorize");
  assert.deepEqual(await keys.answer(first.login, "abc#def"), { kind: "done" });
});

test("a device code is shown to wait on, and the sign-in finishes when the provider says so; it can be stopped", async () => {
  let confirm: () => void = () => {};
  const copilot = fake("fake-copilot", {
    name: "Fake Copilot",
    isSubscription: true,
    async login(interaction) {
      interaction.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.example.com/login/device", expiresInSeconds: 900 });
      await new Promise<void>((resolve, reject) => {
        confirm = resolve;
        interaction.signal.addEventListener("abort", () => reject(new Error("Login cancelled")));
      });
      return tokens(1);
    },
    refresh: async () => tokens(2),
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { keys } = await setup([copilot]);
  const first = await keys.login("fake-copilot", "account");
  if (first.kind !== "wait") return assert.fail(`expected a wait, got ${first.kind}`);
  assert.equal(first.device?.code, "ABCD-1234");
  assert.equal(first.device?.url, "https://github.example.com/login/device");
  assert.ok(first.device?.expires && Date.parse(first.device.expires) > Date.now());
  const next = keys.wait(first.login);
  confirm();
  assert.deepEqual(await next, { kind: "done" });
  // asked again a little later, it still says how it ended
  assert.deepEqual(await keys.wait(first.login), { kind: "done" });
  assert.equal((await keys.list()).providers.find((p) => p.id === "fake-copilot")?.way, "account");

  const again = await keys.login("fake-copilot", "account");
  if (again.kind !== "wait") return assert.fail("expected a wait");
  const stopped = keys.wait(again.login);
  await keys.cancel(again.login);
  assert.deepEqual(await stopped, { kind: "failed", reason: "The sign-in was stopped." });
});

test("when the provider's page reaches the server itself, the pasted answer is no longer waited for", async () => {
  let callback: () => void = () => {};
  const router = fake("fake-router", {
    name: "Fake OpenRouter",
    async login(interaction) {
      interaction.notify({ type: "auth_url", url: "https://router.example.com/auth" });
      const manual = new AbortController();
      const reached = new Promise<void>((resolve) => (callback = resolve));
      const pasted = interaction.prompt({ type: "manual_code", message: "Paste", placeholder: "http://127.0.0.1:4000/cb", signal: manual.signal }).catch(() => "");
      await reached;
      manual.abort();
      await pasted;
      return tokens(1);
    },
    refresh: async () => tokens(2),
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { keys } = await setup([router]);
  const first = await keys.login("fake-router", "account");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  const next = keys.wait(first.login);
  callback();
  assert.deepEqual(await next, { kind: "done" });
  assert.equal((await keys.answer(first.login, "http://127.0.0.1:4000/cb?code=late")).kind, "failed");
});

test("a provider without a sign-in is set up by key only", async () => {
  const { keys } = await setup([]);
  const step = await keys.login("fireworks", "account");
  assert.equal(step.kind, "failed");
  const { providers } = await keys.list();
  assert.equal(providers.find((p) => p.id === "fireworks")?.account, null);
  // the current Sign in with ChatGPT, not the legacy Codex sign-in that takes no key
  assert.equal(providers.find((p) => p.id === "openai")?.account?.subscription, true);
  assert.equal(providers.find((p) => p.id === "openai-codex"), undefined);
  assert.equal(providers.find((p) => p.id === "anthropic")?.account?.subscription, true);
});

test("expired tokens are refreshed once, in the Vault entry they are kept in, and the new ones replace the old", async () => {
  let refreshed = 0;
  const provider = fake("fake-refresh", {
    name: "Fake refresh",
    login: async () => tokens(1),
    async refresh(credential) {
      refreshed++;
      assert.equal(credential.refresh, "refresh_secret_1");
      assert.equal(credential["accountId"], "acct-1", "what the provider keeps beside the tokens is handed back");
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ...tokens(2), accountId: credential["accountId"] };
    },
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { store, kept, file, models } = await setup([provider]);
  await file.modify("fake-refresh", async () => ({ ...tokens(1), expires: Date.now() - 1000 }));

  const [a, b] = await Promise.all([models.getAuth("fake-refresh"), models.getAuth("fake-refresh")]);
  assert.equal(refreshed, 1, "two requests at once refresh only once");
  assert.equal(a?.auth.apiKey, "access_secret_2");
  assert.equal(b?.auth.apiKey, "access_secret_2");

  // one entry, changed in place, holding the tokens that came back
  assert.equal(kept.size, 1, "the refresh does not make a second entry");
  const entry = [...kept.values()][0];
  assert.equal(entry?.managed, true);
  assert.deepEqual(entry?.secret, [
    { name: "access", text: "access_secret_2" },
    { name: "refresh", text: "refresh_secret_2" },
  ]);
  assert.deepEqual(entry?.plain.find((f) => f.name === "accountId"), { name: "accountId", text: "acct-1" }, "the account id stays beside the tokens");
  assert.ok(!file.secrets().includes("refresh_secret_1"), "the old tokens are gone");
  // errors leave out the new tokens too
  assert.deepEqual(file.secrets(), ["access_secret_2", "refresh_secret_2"]);

  // kept across a restart: Pi's credentials read the same Vault entry back
  const reopened = storeCredentials(store);
  const credential = await reopened.read("fake-refresh");
  assert.equal(credential?.type === "oauth" ? credential.access : undefined, "access_secret_2");
});

/** A port nothing holds: the stand-in for OpenAI's 127.0.0.1:1455, which its own sign-in holds while it waits. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Whether that port can be taken again: what a sign-in that let it go leaves behind. */
async function free(port: number): Promise<boolean> {
  const server = createServer();
  const taken = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (taken) await new Promise<void>((resolve) => server.close(() => resolve()));
  return taken;
}

/** A call that must answer: what Pi's sign-in queue does to a second one is never answer at all. */
function answered<T>(call: Promise<T>): Promise<T | "no answer"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"no answer">((resolve) => (timer = setTimeout(() => resolve("no answer"), 2000)));
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
}

test("a second sign-in for a provider hears the step the first is on, and stopping it lets the port go", async () => {
  // the port a provider's own sign-in holds while it waits
  const port = await freePort();
  let held = 0;
  const twice = fake("fake-twice", {
    name: "Fake twice",
    async login(interaction) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      held++;
      interaction.notify({ type: "auth_url", url: "https://auth.example.com/authorize?state=s" });
      try {
        await new Promise<void>((_resolve, reject) => interaction.signal.addEventListener("abort", () => reject(new Error("Login cancelled")), { once: true }));
      } finally {
        // what a provider's own sign-in does when it is stopped
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      return tokens(1);
    },
    refresh: async () => tokens(2),
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { keys } = await setup([twice]);

  const first = await keys.login("fake-twice", "account");
  if (first.kind !== "wait") return assert.fail(`expected a wait, got ${first.kind}`);

  // a second sheet for the same provider: it hears where the sign-in stands instead of waiting on Pi's queue
  const second = await answered(keys.login("fake-twice", "account"));
  if (second === "no answer") return assert.fail("the second sign-in never answered");
  assert.equal(second.kind, "wait");
  assert.equal(second.kind === "wait" ? second.login : null, first.login, "the second sheet resumes the sign-in that is going on");
  assert.equal(held, 1, "the provider's own sign-in ran once, not twice");

  // stopping it from either sheet stops the one sign-in there is, and the port it held is free again
  const stopped = keys.wait(first.login);
  await keys.cancel(second.kind === "wait" ? second.login : "");
  assert.deepEqual(await stopped, { kind: "failed", reason: "The sign-in was stopped." });
  assert.equal(await free(port), true, "the port the sign-in held is free again");

  // and a sign-in started after that is a new one, not the one that ended
  const again = await answered(keys.login("fake-twice", "account"));
  if (again === "no answer") return assert.fail("the sign-in after that never answered");
  assert.equal(again.kind, "wait");
  assert.notEqual(again.kind === "wait" ? again.login : null, first.login);
  assert.equal(held, 2);
  await keys.cancel(again.kind === "wait" ? again.login : "");
});

test("only an API key makes a provider a speech service, not a sign-in with the account", async () => {
  const openai = fake("openai", {
    name: "OpenAI",
    async login() {
      return tokens(1);
    },
    refresh: async () => tokens(2),
    toAuth: async (credential) => ({ apiKey: credential.access }),
  });
  const { keys } = await setup([openai]);

  assert.deepEqual(await keys.login("openai", "account"), { kind: "done" });
  assert.equal((await keys.list()).providers.find((p) => p.id === "openai")?.way, "account");
  assert.deepEqual((await keys.list()).voice.services, [], "a sign-in is no speech service");
  await assert.rejects(keys.voice("openai"), /API key only/);
  assert.equal(keys.voiceChoice(), null);

  // the key the provider also takes is one
  await keys.logout("openai");
  const byKey = await keys.login("openai");
  if (byKey.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(byKey.login, "sk-fake-openai-key-1234");
  assert.deepEqual((await keys.list()).voice.services, [{ provider: "openai", name: "OpenAI (GPT-4o mini Transcribe)" }]);
  await keys.voice("openai");
  assert.equal(keys.voiceChoice(), "openai");
});
