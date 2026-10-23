import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type OAuthAuth, type OAuthCredential, type Provider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { fileCredentials } from "./credentials.ts";
import { piKeys } from "./keys.ts";
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

const tokens = (n: number): OAuthCredential => ({ type: "oauth", access: `access_secret_${n}`, refresh: `refresh_secret_${n}`, expires: Date.now() + 3_600_000, accountId: "acct-1" });

async function setup(providers: Provider[]) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-oauth-"));
  const path = join(dir, "keys.json");
  const file = fileCredentials(path);
  const models = await runtime({ auth: { kind: "keys", keys: file } });
  for (const p of providers) models.registerNativeProvider(p);
  return { dir, path, file, models, keys: piKeys({ keys: file, choicePath: join(dir, "models.json") }) };
}

test("signing in with an account: the provider's page, then the address it ends on pasted back; the tokens stay on the server", async () => {
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
  const { keys, path } = await setup([chat]);
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

  // the installation's id is a UUID, the same every time
  assert.match(seen.device ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(seen.agent, "Amuse");

  const after = await keys.list();
  const signedIn = after.providers.find((p) => p.id === "fake-chat");
  assert.equal(signedIn?.connected, true);
  assert.equal(signedIn?.way, "account");
  assert.equal(signedIn?.hint, null, "a sign-in shows no end of a token");
  assert.ok(!JSON.stringify(after).includes("secret"), "no token comes back");
  assert.ok(readFileSync(path, "utf8").includes("refresh_secret_1"));
  assert.equal(statSync(path).mode & 0o777, 0o600);

  // signing out forgets the tokens
  await keys.logout("fake-chat");
  assert.ok(!readFileSync(path, "utf8").includes("secret"));
  assert.equal((await keys.list()).providers.find((p) => p.id === "fake-chat")?.way, null);
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

test("expired tokens are refreshed once, in the keys store, and the new ones replace the old", async () => {
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
  const { file, models, path } = await setup([provider]);
  await file.modify("fake-refresh", async () => ({ ...tokens(1), expires: Date.now() - 1000 }));

  const [a, b] = await Promise.all([models.getAuth("fake-refresh"), models.getAuth("fake-refresh")]);
  assert.equal(refreshed, 1, "two requests at once refresh only once");
  assert.equal(a?.auth.apiKey, "access_secret_2");
  assert.equal(b?.auth.apiKey, "access_secret_2");

  const kept = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(kept["fake-refresh"].refresh, "refresh_secret_2");
  assert.equal(kept["fake-refresh"].accountId, "acct-1");
  assert.ok(!readFileSync(path, "utf8").includes("refresh_secret_1"));
  // errors leave out the new tokens too
  assert.ok(file.secrets().includes("refresh_secret_2") && file.secrets().includes("access_secret_2"));

  // kept across restarts
  const reopened = fileCredentials(path);
  const credential = await reopened.read("fake-refresh");
  assert.equal(credential?.type === "oauth" ? credential.access : undefined, "access_secret_2");
});
