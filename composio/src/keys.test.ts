import assert from "node:assert/strict";
import { test } from "node:test";
import { Rejected } from "@amuse/core";
import { memoryRules } from "@amuse/core";
import { CannotLink, ComposioError, NoComposioKey, type Toolkit, accessOf, composio, ownOAuthOnly, schemeSummary } from "./client.ts";
import { composioDirectory } from "./directory.ts";
import { composioSaid } from "./said.ts";

/**
 * Composio's real answers, as its own SDK and docs describe them: the shape `@composio/client`'s
 * ToolkitRetrieveResponse declares, and the toolkits generated from the live API into Composio's docs (the Cloudflare
 * ones here are `GET /toolkits/cloudflare` and `/toolkits/cloudflare_api_key` as of toolkit versions 20261021_00
 * and 20260826_00). The label is `displayName` on the wire, and a field group may be absent altogether.
 */
const field = (name: string, displayName: string) => ({ name, displayName, type: "string", required: true, description: "", default: null });
const none = { required: [], optional: [] };
/** one scheme asking for fields when the account is made (the usual shape for a key) */
const initiating = (required: unknown[]) => ({ auth_config_creation: none, connected_account_initiation: { required, optional: [] } });

/** GET /toolkits/gmail: Composio hosts the login. */
const gmail = {
  name: "Gmail",
  slug: "gmail",
  composio_managed_auth_schemes: ["OAUTH2"],
  auth_config_details: [{ mode: "OAUTH2", name: "gmail_oauth", fields: { auth_config_creation: none, connected_account_initiation: none } }],
};
/** GET /toolkits/cloudflare: an API key, and it asks for two things at once (the global key and the account email). */
const cloudflare = {
  name: "Cloudflare",
  slug: "cloudflare",
  composio_managed_auth_schemes: [],
  auth_config_details: [
    {
      mode: "API_KEY",
      name: "cloudflare_api_key",
      fields: initiating([field("generic_api_key", "Cloudflare Global API Key"), field("generic_id", "Cloudflare Account Email")]),
    },
  ],
};
/** GET /toolkits/cloudflare_api_key: the same service's token toolkit, one field, "Cloudflare API Token". */
const cloudflareApiKey = {
  name: "Cloudflare Api Key",
  slug: "cloudflare_api_key",
  composio_managed_auth_schemes: [],
  auth_config_details: [{ mode: "API_KEY", name: "cloudflare_api_key", fields: initiating([field("generic_api_key", "Cloudflare API Token")]) }],
};
/** GET /toolkits/twitter: your own OAuth app, whose client id and secret Amuse cannot supply. */
const twitter = {
  name: "Twitter",
  slug: "twitter",
  composio_managed_auth_schemes: [],
  auth_config_details: [
    {
      mode: "OAUTH2",
      name: "twitter_oauth",
      fields: { auth_config_creation: { required: [field("client_id", "Client id"), field("client_secret", "Client secret")], optional: [] }, connected_account_initiation: none },
    },
  ],
};
/** a bearer token: a key with one secret field, so the same card connects it */
const bearer = {
  name: "Bearer App",
  slug: "bearer_app",
  composio_managed_auth_schemes: [],
  auth_config_details: [{ mode: "BEARER_TOKEN", name: "bearer_app", fields: initiating([field("token", "API token")]) }],
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

/**
 * The list endpoint's own auth fields (`GET /toolkits`): `auth_schemes` and which of them Composio manages. Enough
 * to leave out an own-OAuth-app toolkit without asking about each one (the slugs and schemes are Composio's).
 */
const listed = (slug: string, name: string, schemes: string[], managedSchemes: string[] = []): Toolkit => ({ slug, name, description: "", logo: null, categories: [], schemes, managedSchemes });
const list: Toolkit[] = [
  listed("gmail", "Gmail", ["OAUTH2"], ["OAUTH2"]),
  listed("cloudflare", "Cloudflare", ["API_KEY"]),
  listed("cloudflare_api_key", "Cloudflare Api Key", ["API_KEY"]),
  listed("cloudflare_mcp", "Cloudflare MCP", ["DCR_OAUTH"]),
  listed("twitter", "Twitter", ["OAUTH2"]),
  listed("mystery", "Mystery", []),
];
const fakes = { gmail, cloudflare, cloudflare_api_key: cloudflareApiKey, twitter, bearer_app: bearer };

test("the scheme is read from the toolkit: Composio's own login, an API key with its label, or neither", () => {
  assert.deepEqual(accessOf(gmail), { kind: "managed", name: "Gmail" });
  assert.deepEqual(accessOf(cloudflareApiKey), { kind: "key", name: "Cloudflare Api Key", mode: "API_KEY", field: "generic_api_key", label: "Cloudflare API Token" });
  // a bearer token is a key with one secret field: the same card connects it
  assert.deepEqual(accessOf(bearer), { kind: "key", name: "Bearer App", mode: "BEARER_TOKEN", field: "token", label: "API token" });
  // Cloudflare's own toolkit asks for two things at once (its global key and the account email), which is not one card
  assert.deepEqual(accessOf(cloudflare), { kind: "unsupported", name: "Cloudflare" });
  // your own OAuth app (client id and secret), which Amuse cannot supply
  assert.deepEqual(accessOf(twitter), { kind: "unsupported", name: "Twitter" });
  // the label is read in either spelling, and falls back to the field's name; a lowercase mode is read too
  const snake = { ...cloudflareApiKey, auth_config_details: [{ mode: "api_key", fields: initiating([{ name: "token", display_name: "Token" }]) }] };
  assert.deepEqual(accessOf(snake), { kind: "key", name: "Cloudflare Api Key", mode: "API_KEY", field: "token", label: "Token" });
  // a response with no auth details at all is not a failure: it is simply not a key
  assert.deepEqual(accessOf({ name: "Nowhere", slug: "nowhere" }), { kind: "unsupported", name: "Nowhere" });
  // a managed login wins over a key the toolkit also takes
  assert.equal(accessOf({ ...cloudflareApiKey, composio_managed_auth_schemes: ["API_KEY"] }).kind, "managed");
});

test("a managed toolkit connects by link, as before", async () => {
  const { client, calls } = fakeComposio(fakes, [{ id: "ac_managed" }]);
  assert.deepEqual(await client.link("gmail", "owner"), { url: "https://connect.example/x", account: "ca_1" });
  assert.equal(calls[0]?.path, "/api/v3.1/toolkits/gmail");
  assert.deepEqual(calls.at(-1)?.body, { auth_config_id: "ac_managed", user_id: "owner" });
});

test("a key toolkit is not linked: the user is asked for the key, by the provider's name for it", async () => {
  const { client, calls } = fakeComposio(fakes);
  await assert.rejects(client.link("cloudflare_api_key", "owner"), (e) => e instanceof CannotLink && e.why === "key" && e.label === "Cloudflare API Token");
  assert.deepEqual(calls.map((c) => c.method), ["GET"], "no managed auth config was tried");
  await assert.rejects(client.link("twitter", "owner"), (e) => e instanceof CannotLink && e.why === "unsupported");
});

test("the key makes a custom auth config and a connected account; the config never holds it", async () => {
  const { client, calls } = fakeComposio(fakes);
  await client.linkWithKey("cloudflare_api_key", "owner", "secret-token-1");
  const [, list, create, account] = calls;
  assert.equal(list?.path, "/api/v3.1/auth_configs");
  // `authScheme` is the field Composio's own SDK sends for a custom auth config (its response calls it auth_scheme)
  assert.deepEqual(create?.body, { toolkit: { slug: "cloudflare_api_key" }, auth_config: { type: "use_custom_auth", authScheme: "API_KEY", name: "Cloudflare Api Key", credentials: {} } });
  assert.deepEqual(account?.body, { auth_config: { id: "ac_new" }, connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { generic_api_key: "secret-token-1" } } } });
  assert.equal(JSON.stringify([list, create]).includes("secret-token-1"), false);
});

test("an existing custom auth config for the key is reused", async () => {
  const { client, calls } = fakeComposio(fakes, [{ id: "ac_oauth", auth_scheme: "OAUTH2" }, { id: "ac_key", auth_scheme: "API_KEY" }]);
  await client.linkWithKey("cloudflare_api_key", "owner", "k");
  assert.equal(calls.some((c) => c.method === "POST" && c.path.endsWith("/auth_configs")), false);
  assert.deepEqual(calls.at(-1)?.body, { auth_config: { id: "ac_key" }, connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { generic_api_key: "k" } } } });
});

test("a key the provider turns down says so, and the key is in no message", async () => {
  const { client } = fakeComposio(fakes, [], true);
  await assert.rejects(client.linkWithKey("cloudflare_api_key", "owner", "bad-token-2"), (e) => e instanceof CannotLink && e.why === "rejected" && !e.message.includes("bad-token-2"));
  await assert.rejects(fakeComposio(fakes).client.linkWithKey("gmail", "owner", "k"), (e) => e instanceof CannotLink && e.why === "managed");
});

test("the directory tells the app how an app connects, and passes a key on", async () => {
  const { client, calls } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => list }, { userId: "owner", rules: memoryRules() });
  assert.deepEqual(await directory.access("gmail"), { kind: "managed" });
  assert.deepEqual(await directory.access("cloudflare_api_key"), { kind: "key", label: "Cloudflare API Token" });
  await assert.rejects(directory.access("twitter"), CannotLink);
  await directory.connectKey("cloudflare_api_key", "k");
  assert.equal(calls.at(-1)?.path, "/api/v3.1/connected_accounts");
});

test("only a toolkit whose every way in is your own OAuth app is left out; anything unknown stays", () => {
  assert.equal(ownOAuthOnly(["OAUTH2"], []), true);
  assert.equal(ownOAuthOnly(["OAUTH1", "S2S_OAUTH2"], []), true);
  assert.equal(ownOAuthOnly(["OAUTH2"], ["OAUTH2"]), false, "Composio manages that login");
  assert.equal(ownOAuthOnly(["OAUTH2", "API_KEY"], []), false, "it takes a key");
  assert.equal(ownOAuthOnly(["DCR_OAUTH"], []), false, "not a scheme to hide on: Composio's docs list cloudflare_mcp as managed");
  assert.equal(ownOAuthOnly(["SAML"], []), false, "a scheme Amuse does not know");
  assert.equal(ownOAuthOnly([], []), false, "nothing known about it at all");
});

test("an own-OAuth-app toolkit is not offered in the directory; the rest are, as Composio lists them", async () => {
  const { client } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => list }, { userId: "owner", rules: memoryRules() });
  const offered = async (query: string) => (await directory.search(query, null)).apps.map((a) => a.id);
  assert.deepEqual(await offered("twitter"), []);
  assert.deepEqual(await offered(""), ["gmail", "cloudflare", "cloudflare_api_key", "cloudflare_mcp", "mystery"]);
});

test("the agent hears a toolkit cannot be connected here, and which sibling takes a key instead", async () => {
  const { client } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => list }, { userId: "owner", rules: memoryRules() });
  assert.equal(await directory.cannotConnect("gmail"), null, "it can be connected: nothing to say");
  assert.equal(await directory.cannotConnect("cloudflare_api_key"), null);
  const twoFields = await directory.cannotConnect("cloudflare");
  assert.match(twoFields ?? "", /Cloudflare cannot be connected here: it needs credentials of your own that Amuse cannot set up\. Cloudflare Api Key \(cloudflare_api_key\) does the same job with a key or a token: ask the user for that one instead\./);
  const alone = await directory.cannotConnect("twitter");
  assert.match(alone ?? "", /Twitter cannot be connected here/);
  assert.doesNotMatch(alone ?? "", /instead/, "no sibling of the same service takes a key");
});

test("a toolkit Amuse cannot classify is logged once, by its modes and field names", async () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => void lines.push(line);
  try {
    const { client } = fakeComposio(fakes);
    await client.access("cloudflare");
    await client.access("cloudflare");
    await client.access("twitter");
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(
    lines.map((line) => line.replace(/^Composio toolkit \S+ cannot be classified: /, "")),
    ["managed schemes [none]; schemes API_KEY [generic_api_key, generic_id]", "managed schemes [none]; schemes OAUTH2 [client_id, client_secret]"],
  );
});

test("the scheme summary names modes and fields, and never a value", () => {
  const withValues = {
    name: "X",
    auth_config_details: [
      {
        mode: "API_KEY",
        fields: {
          auth_config_creation: { required: [], optional: [{ name: "client_id", displayName: "Client id", default: "sh-secret-value", is_secret: true }] },
          connected_account_initiation: { required: [{ name: "token", displayName: "Token", default: "sh-secret-value" }], optional: [] },
        },
      },
    ],
  };
  assert.equal(schemeSummary(withValues), "managed schemes [none]; schemes API_KEY [token, client_id]");
  assert.equal(schemeSummary(withValues).includes("sh-secret-value"), false);
  assert.equal(schemeSummary({ name: "Nothing" }), "managed schemes [none]; schemes none");
  assert.equal(schemeSummary(null), "no toolkit response to read");
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
