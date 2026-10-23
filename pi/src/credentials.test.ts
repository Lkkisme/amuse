import assert from "node:assert/strict";
import { test } from "node:test";
import type { Credential } from "@earendil-works/pi-ai";
import type { ServiceKey, ServiceStore, ServiceWrite } from "@amuse/core";
import { LOCAL_VOICE, credentialOf, serves, storeCredentials, written } from "./credentials.ts";

/** The Vault as far as the credentials need it, in memory; it counts the uses it records. */
function memory() {
  const kept = new Map<string, ServiceWrite>();
  const key = (service: string, target: string) => [...kept.entries()].find(([, w]) => w.targets.some((t) => t.service === service && t.target === target));
  let recorded = 0;
  let writes = 0;
  const store: ServiceStore = {
    serviceKey(service, target, record = true) {
      const found = key(service, target);
      if (!found) return undefined;
      if (record) recorded++;
      const [, w] = found;
      const values = Object.fromEntries([...w.plain, ...w.secret].map((f) => [f.name, f.text]));
      const entry: ServiceKey["entry"] = {
        id: found[0],
        name: w.name,
        managed: w.managed,
        plain: [],
        secret: [],
        note: "",
        uses: [],
        created: "",
      };
      return { entry, field: w.bound, values };
    },
    serviceTargets: () => [...kept.values()].flatMap((w) => w.targets),
    async putService(w) {
      writes++;
      const first = w.targets[0];
      const before = first && key(first.service, first.target);
      kept.set(before?.[0] ?? `e-${kept.size + 1}`, w);
    },
    async dropService(service, target) {
      const found = key(service, target);
      if (found) kept.delete(found[0]);
    },
    serviceSecrets: () => [...kept.values()].flatMap((w) => w.secret.map((f) => f.text)),
  };
  return { store, kept, recorded: () => recorded, writes: () => writes };
}

test("a credential id serves what it stands for: a provider's models (and speech where it has any), the apps, the user's speech server", () => {
  assert.deepEqual(serves("openrouter", ["composio"]), [{ service: "model", target: "openrouter" }]);
  assert.deepEqual(serves("groq", ["composio"]), [
    { service: "model", target: "groq" },
    { service: "voice", target: "groq" },
  ]);
  assert.deepEqual(serves("composio", ["composio"]), [{ service: "apps", target: "composio" }]);
  assert.deepEqual(serves(LOCAL_VOICE, []), [{ service: "voice", target: "local" }]);
});

test("an API key and its settings round-trip: the key and anything secret-looking are secret, an account or a region is plain", async () => {
  const { store, kept } = memory();
  const keys = storeCredentials(store, { names: () => "Cloudflare AI" });
  const credential: Credential = { type: "api_key", key: "cf-fake-key-1111", env: { CLOUDFLARE_ACCOUNT_ID: "acct-9", CLOUDFLARE_GATEWAY_TOKEN: "gw-fake-2222" } };
  await keys.modify("cloudflare-ai-gateway", async () => credential);
  const entry = [...kept.values()][0];
  assert.deepEqual(entry?.plain, [{ name: "CLOUDFLARE_ACCOUNT_ID", text: "acct-9" }]);
  assert.deepEqual(entry?.secret.map((f) => f.name), ["key", "CLOUDFLARE_GATEWAY_TOKEN"]);
  assert.equal(entry?.managed, false);
  assert.deepEqual(await keys.read("cloudflare-ai-gateway"), credential);
  assert.deepEqual(await keys.list(), [{ providerId: "cloudflare-ai-gateway", type: "api_key" }]);
  assert.deepEqual(keys.secrets(), ["cf-fake-key-1111", "gw-fake-2222"]);
  await keys.delete("cloudflare-ai-gateway");
  assert.equal(await keys.read("cloudflare-ai-gateway"), undefined);
  assert.deepEqual(await keys.list(), []);
});

test("the key of a speech provider serves its models and its speech; the user's own speech server has an id of its own", async () => {
  const { store, kept } = memory();
  const keys = storeCredentials(store, { apps: ["composio"] });
  await keys.modify("openai", async () => ({ type: "api_key", key: "sk-fake-3333" }));
  await keys.modify(LOCAL_VOICE, async () => ({ type: "api_key", key: "local-fake-4444" }));
  await keys.modify("composio", async () => ({ type: "api_key", key: "ak_fake_5555" }));
  assert.deepEqual([...kept.values()].map((w) => w.targets), [
    [{ service: "model", target: "openai" }, { service: "voice", target: "openai" }],
    [{ service: "voice", target: "local" }],
    [{ service: "apps", target: "composio" }],
  ]);
  assert.deepEqual((await keys.list()).map((c) => c.providerId), ["openai", LOCAL_VOICE, "composio"]);
  assert.deepEqual(await keys.read("composio"), { type: "api_key", key: "ak_fake_5555" });
});

test("an OAuth sign-in is a managed entry: tokens secret, expiry and the rest plain; it reads back as it was", async () => {
  const { store, kept } = memory();
  const keys = storeCredentials(store, { names: () => "OpenAI" });
  const signedIn: Credential = { type: "oauth", access: "acc-fake-0001", refresh: "ref-fake-0001", expires: 1_777_777_777_000, accountId: "acct-42", scopes: ["a", "b"] };
  await keys.modify("openai", async () => signedIn);
  const entry = [...kept.values()][0];
  assert.equal(entry?.managed, true);
  assert.equal(entry?.bound, "access");
  assert.deepEqual(entry?.secret, [{ name: "access", text: "acc-fake-0001" }, { name: "refresh", text: "ref-fake-0001" }]);
  assert.deepEqual(entry?.plain, [
    { name: "expires", text: "1777777777000" },
    { name: "accountId", text: "acct-42" },
    { name: "scopes:json", text: '["a","b"]' },
  ]);
  assert.deepEqual(await keys.read("openai"), signedIn);
  assert.deepEqual(await keys.list(), [{ providerId: "openai", type: "oauth" }]);
  assert.deepEqual(keys.secrets(), ["acc-fake-0001", "ref-fake-0001"]);
});

test("a token refresh changes the sign-in in place, one at a time, and is neither a use nor a card", async () => {
  const { store, kept, recorded, writes } = memory();
  const keys = storeCredentials(store);
  await keys.modify("openai", async () => ({ type: "oauth", access: "acc-fake-0001", refresh: "ref-fake-0001", expires: 1000 }));
  const usedBefore = recorded();
  // two refreshes at once: each sees what the one before wrote (Pi refreshes inside modify)
  const seen: (string | undefined)[] = [];
  const refresh = (n: number) =>
    keys.modify("openai", async (current) => {
      assert.equal(current?.type, "oauth");
      seen.push(current?.type === "oauth" ? current.access : undefined);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { type: "oauth", access: `acc-fake-000${n}`, refresh: `ref-fake-000${n}`, expires: 1000 * n };
    });
  const [first, second] = await Promise.all([refresh(2), refresh(3)]);
  assert.deepEqual(seen, ["acc-fake-0001", "acc-fake-0002"]);
  assert.equal(first?.type === "oauth" && first.access, "acc-fake-0002");
  assert.equal(second?.type === "oauth" && second.access, "acc-fake-0003");
  assert.equal(kept.size, 1, "one entry, changed in place");
  assert.equal(recorded(), usedBefore, "a refresh reads without it counting as a use");
  assert.equal(writes(), 3);
  // returning nothing leaves it alone
  assert.equal((await keys.modify("openai", async () => undefined))?.type, "oauth");
  assert.equal(writes(), 3);
  // reading it for a request is a use
  await keys.read("openai");
  assert.equal(recorded(), usedBefore + 1);
});

test("what a credential is made of is written whole: a credential with nothing to keep is refused", () => {
  assert.throws(() => written("X", "x", { type: "api_key" }, []), /nothing to keep/);
  // settings alone (no key) are all kept secret, the first one standing for the use
  const only = written("Bedrock", "amazon-bedrock", { type: "api_key", env: { AWS_REGION: "eu-1" } }, []);
  assert.deepEqual(only.secret, [{ name: "AWS_REGION", text: "eu-1" }]);
  assert.equal(only.bound, "AWS_REGION");
});

test("the key is the field the use is bound to: one a person named ('token') is the key, a settings-only credential has none, and nothing readable is no credential", async () => {
  const { store } = memory();
  const keys = storeCredentials(store);
  // an entry the user made, with a use for a provider on its field called "token"
  await store.putService({ name: "Mine", managed: false, targets: [{ service: "model", target: "groq" }], bound: "token", plain: [{ name: "organization", text: "org-1" }], secret: [{ name: "token", text: "gk-fake-0123456789" }] });
  assert.deepEqual(await keys.read("groq"), { type: "api_key", key: "gk-fake-0123456789", env: { organization: "org-1" } });
  // settings only: bound to a setting, which is named like a variable, so it is not the key
  await store.putService({ name: "Bedrock", managed: false, targets: [{ service: "model", target: "amazon-bedrock" }], bound: "AWS_REGION", plain: [], secret: [{ name: "AWS_REGION", text: "eu-1" }] });
  assert.deepEqual(await keys.read("amazon-bedrock"), { type: "api_key", env: { AWS_REGION: "eu-1" } });
  // what could not be read (the key's field is gone from what the store gave) is nothing, not a credential without its key
  assert.equal(credentialOf({}, false, "key"), undefined);
  assert.equal(credentialOf({ other: "x" }, false, "key"), undefined, "a key that is not there is not a credential with only the rest of it");
  assert.equal(credentialOf({ other: "x" }, false, "token"), undefined);
});
