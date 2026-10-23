import assert from "node:assert/strict";
import { test } from "node:test";
import { Rejected } from "@amuse/core";
import { memoryRules } from "@amuse/core";
import { CannotLink, ComposioError, NoComposioKey, accessOf, composio } from "./client.ts";
import { composioDirectory } from "./directory.ts";
import { composioSaid } from "./said.ts";

const field = (name: string, displayName: string) => ({ name, displayName, type: "string", required: true });
const none = { required: [] };
const managed = { name: "Gmail", composio_managed_auth_schemes: ["OAUTH2"], auth_config_details: [{ mode: "OAUTH2", fields: { auth_config_creation: none, connected_account_initiation: none } }] };
const cloudflare = {
  name: "Cloudflare",
  composio_managed_auth_schemes: [],
  auth_config_details: [{ mode: "API_KEY", fields: { auth_config_creation: none, connected_account_initiation: { required: [field("generic_api_key", "API Token")] } } }],
};
const ownOAuth = {
  name: "Zoom",
  composio_managed_auth_schemes: [],
  auth_config_details: [{ mode: "OAUTH2", fields: { auth_config_creation: { required: [field("client_id", "Client ID")] }, connected_account_initiation: none } }],
};

/** A Composio that records what it was asked, with toolkits by slug and the auth configs it already has. */
function fakeComposio(toolkits: Record<string, unknown>, configs: unknown[] = [], reject = false) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, body });
    const slug = url.pathname.split("/toolkits/")[1];
    if (slug) return slug in toolkits ? Response.json(toolkits[slug]) : new Response("{}", { status: 404 });
    if (url.pathname.endsWith("/auth_configs") && method === "GET") return Response.json({ items: configs });
    if (url.pathname.endsWith("/auth_configs")) return Response.json({ auth_config: { id: "ac_new" } });
    if (url.pathname.endsWith("/connected_accounts") && method === "POST")
      return reject ? new Response(JSON.stringify({ error: { slug: "ConnectedAccount_CredentialValidationRejected" } }), { status: 400 }) : Response.json({ id: "ca_key" });
    if (url.pathname.endsWith("/connected_accounts/link")) return Response.json({ redirect_url: "https://connect.example/x", connected_account_id: "ca_1" });
    return new Response("{}", { status: 500 });
  };
  return { client: composio("ak_test", http), calls };
}
const fakes = { gmail: managed, cloudflare, zoom: ownOAuth };

test("the scheme is read from the toolkit: Composio's own login, an API key with its label, or neither", () => {
  assert.deepEqual(accessOf(managed), { kind: "managed", name: "Gmail" });
  assert.deepEqual(accessOf(cloudflare), { kind: "key", name: "Cloudflare", mode: "API_KEY", field: "generic_api_key", label: "API Token" });
  assert.deepEqual(accessOf(ownOAuth), { kind: "unsupported", name: "Zoom" });
  // the label is read in either spelling, and falls back to the field's name
  const snake = { ...cloudflare, auth_config_details: [{ mode: "api_key", fields: { auth_config_creation: none, connected_account_initiation: { required: [{ name: "token", display_name: "Token" }] } } }] };
  assert.deepEqual(accessOf(snake), { kind: "key", name: "Cloudflare", mode: "API_KEY", field: "token", label: "Token" });
  // a managed login wins over a key the toolkit also takes
  assert.equal(accessOf({ ...cloudflare, composio_managed_auth_schemes: ["API_KEY"] }).kind, "managed");
});

test("a managed toolkit connects by link, as before", async () => {
  const { client, calls } = fakeComposio(fakes, [{ id: "ac_managed" }]);
  assert.deepEqual(await client.link("gmail", "owner"), { url: "https://connect.example/x", account: "ca_1" });
  assert.equal(calls[0]?.path, "/api/v3.1/toolkits/gmail");
  assert.deepEqual(calls.at(-1)?.body, { auth_config_id: "ac_managed", user_id: "owner" });
});

test("a key toolkit is not linked: the user is asked for the key, by the provider's name for it", async () => {
  const { client, calls } = fakeComposio(fakes);
  await assert.rejects(client.link("cloudflare", "owner"), (e) => e instanceof CannotLink && e.why === "key" && e.label === "API Token");
  assert.deepEqual(calls.map((c) => c.method), ["GET"], "no managed auth config was tried");
  await assert.rejects(client.link("zoom", "owner"), (e) => e instanceof CannotLink && e.why === "unsupported");
});

test("the key makes a custom auth config and a connected account; the config never holds it", async () => {
  const { client, calls } = fakeComposio(fakes);
  await client.linkWithKey("cloudflare", "owner", "secret-token-1");
  const [, list, create, account] = calls;
  assert.equal(list?.path, "/api/v3.1/auth_configs");
  assert.deepEqual(create?.body, { toolkit: { slug: "cloudflare" }, auth_config: { type: "use_custom_auth", auth_scheme: "API_KEY", name: "Cloudflare", credentials: {} } });
  assert.deepEqual(account?.body, { auth_config: { id: "ac_new" }, connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { generic_api_key: "secret-token-1" } } } });
  assert.equal(JSON.stringify([list, create]).includes("secret-token-1"), false);
});

test("an existing custom auth config for the key is reused", async () => {
  const { client, calls } = fakeComposio(fakes, [{ id: "ac_oauth", auth_scheme: "OAUTH2" }, { id: "ac_key", auth_scheme: "API_KEY" }]);
  await client.linkWithKey("cloudflare", "owner", "k");
  assert.equal(calls.some((c) => c.method === "POST" && c.path.endsWith("/auth_configs")), false);
  assert.deepEqual(calls.at(-1)?.body, { auth_config: { id: "ac_key" }, connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { generic_api_key: "k" } } } });
});

test("a key the provider turns down says so, and the key is in no message", async () => {
  const { client } = fakeComposio(fakes, [], true);
  await assert.rejects(client.linkWithKey("cloudflare", "owner", "bad-token-2"), (e) => e instanceof CannotLink && e.why === "rejected" && !e.message.includes("bad-token-2"));
  await assert.rejects(fakeComposio(fakes).client.linkWithKey("gmail", "owner", "k"), (e) => e instanceof CannotLink && e.why === "managed");
});

test("the directory tells the app how an app connects, and passes a key on", async () => {
  const { client, calls } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => [] }, { userId: "owner", rules: memoryRules() });
  assert.deepEqual(await directory.access("gmail"), { kind: "managed" });
  assert.deepEqual(await directory.access("cloudflare"), { kind: "key", label: "API Token" });
  await assert.rejects(directory.access("zoom"), CannotLink);
  await directory.connectKey("cloudflare", "k");
  assert.equal(calls.at(-1)?.path, "/api/v3.1/connected_accounts");
});

const words = (error: unknown) => {
  const said = composioSaid(error);
  assert.ok(said instanceof Rejected);
  return said.message;
};
const refused = (status: number) => new ComposioError(`failed (${status})`, status);

test("each Composio failure is told for what it is; only no answer or a 5xx is 'could not be reached'", () => {
  const unreachable = /could not be reached/;
  assert.match(words(new ComposioError("no answer", null, { network: true })), unreachable);
  assert.match(words(refused(500)), /could not be reached.*\(500\)/);
  assert.match(words(refused(503)), unreachable);
  for (const status of [400, 404, 422, 429]) assert.doesNotMatch(words(refused(status)), unreachable);
  assert.match(words(refused(401)), /did not accept the key/);
  assert.match(words(refused(403)), /did not accept the key/);
  assert.match(words(refused(404)), /no such app/);
  assert.match(words(refused(429)), /limiting requests/);
  assert.match(words(refused(400)), /turned the request down \(400\)/);
  assert.match(words(new ComposioError("unexpected shape")), /does not understand/);
  assert.match(words(new NoComposioKey()), /not set up yet/);
  assert.match(words(new CannotLink("key", "Cloudflare", "API Token")), /Cloudflare needs your own API Token/);
  assert.match(words(new CannotLink("rejected", "Cloudflare", "API Token")), /did not accept that API Token/);
  assert.match(words(new CannotLink("unsupported", "Zoom")), /cannot set up/);
  assert.match(words(new CannotLink("managed", "Gmail")), /needs no key/);
  const other = new Error("boom");
  assert.equal(composioSaid(other), other, "anything else stays an internal error");
});

test("a request that gets no answer is a network failure, not a status", async () => {
  const down = composio("ak_test", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(down.status("x"), (e) => e instanceof ComposioError && e.network && e.status === null);
});
