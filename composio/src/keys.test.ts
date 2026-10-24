import assert from "node:assert/strict";
import { test } from "node:test";
import { Rejected } from "@amuse/core";
import { memoryRules } from "@amuse/core";
import { CannotLink, ComposioError, NoComposioKey, type Toolkit, accessOf, composio, offeredInDirectory, schemeSummary } from "./client.ts";
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
/**
 * GET /toolkits/workday: your own OAuth app (client id and secret at the config stage), which Amuse cannot set up.
 * Its sibling workday_raas is the one live case of a service with both (GET /toolkits/workday_raas: a base URL, a
 * tenant, a username and a password, all at the account stage).
 */
const workday = {
  name: "Workday",
  slug: "workday",
  composio_managed_auth_schemes: [],
  auth_config_details: [
    {
      mode: "OAUTH2",
      name: "workday_oauth",
      fields: { auth_config_creation: { required: [field("client_id", "Client id"), field("client_secret", "Client secret")], optional: [] }, connected_account_initiation: { required: [field("full", "Workday REST API Endpoint")], optional: [] } },
    },
  ],
};
const workdayRaas = {
  name: "Workday RaaS",
  slug: "workday_raas",
  composio_managed_auth_schemes: [],
  auth_config_details: [
    {
      mode: "API_KEY",
      name: "workday_raas",
      fields: initiating([field("full", "Workday Base URL"), field("suffix.one", "Workday Tenant"), field("username", "Workday Username"), field("password", "Workday Password")]),
    },
  ],
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
  listed("workday", "Workday", ["OAUTH2"]),
  listed("workday_raas", "Workday RaaS", ["API_KEY"]),
  listed("mystery", "Mystery", []),
];
const fakes = { gmail, cloudflare, cloudflare_api_key: cloudflareApiKey, twitter, bearer_app: bearer, workday, workday_raas: workdayRaas };

test("the scheme is read from the toolkit: Composio's own login, the fields of a key, or neither", () => {
  const one = [{ name: "generic_api_key", label: "Cloudflare API Token", secret: true }];
  assert.deepEqual(accessOf(gmail), { kind: "managed", name: "Gmail" });
  assert.deepEqual(accessOf(cloudflareApiKey), { kind: "key", name: "Cloudflare Api Key", mode: "API_KEY", fields: one });
  // a bearer token is a key: one secret field, and the same card connects it
  assert.deepEqual(accessOf(bearer), { kind: "key", name: "Bearer App", mode: "BEARER_TOKEN", fields: [{ name: "token", label: "API token", secret: true }] });
  // Cloudflare's own toolkit asks for two things at once: its global key (a secret) and the account email (plain)
  assert.deepEqual(accessOf(cloudflare), {
    kind: "key",
    name: "Cloudflare",
    mode: "API_KEY",
    fields: [
      { name: "generic_api_key", label: "Cloudflare Global API Key", secret: true },
      { name: "generic_id", label: "Cloudflare Account Email", secret: false },
    ],
  });
  // a field Composio marks as a secret is one, whatever it is called
  const marked = { ...cloudflareApiKey, auth_config_details: [{ mode: "API_KEY", fields: initiating([{ name: "generic_id", displayName: "API Token", is_secret: true }]) }] };
  assert.deepEqual(accessOf(marked), { kind: "key", name: "Cloudflare Api Key", mode: "API_KEY", fields: [{ name: "generic_id", label: "API Token", secret: true }] });
  // your own OAuth app (client id and secret), which Amuse cannot supply
  assert.deepEqual(accessOf(twitter), { kind: "unsupported", name: "Twitter" });
  // the label is read in either spelling, and falls back to the field's name; a lowercase mode is read too
  const snake = { ...cloudflareApiKey, auth_config_details: [{ mode: "api_key", fields: initiating([{ name: "token", display_name: "Token" }]) }] };
  assert.deepEqual(accessOf(snake), { kind: "key", name: "Cloudflare Api Key", mode: "API_KEY", fields: [{ name: "token", label: "Token", secret: true }] });
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
  await client.linkWithKey("cloudflare_api_key", "owner", [{ name: "generic_api_key", value: "secret-token-1" }]);
  const [, list, create, account] = calls;
  assert.equal(list?.path, "/api/v3.1/auth_configs");
  // `authScheme` is the field Composio's own SDK sends for a custom auth config (its response calls it auth_scheme)
  assert.deepEqual(create?.body, { toolkit: { slug: "cloudflare_api_key" }, auth_config: { type: "use_custom_auth", authScheme: "API_KEY", name: "Cloudflare Api Key", credentials: {} } });
  assert.deepEqual(account?.body, { auth_config: { id: "ac_new" }, connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { generic_api_key: "secret-token-1" } } } });
  assert.equal(JSON.stringify([list, create]).includes("secret-token-1"), false);
});

test("a toolkit that asks for several things gets them all, in the one state", async () => {
  const { client, calls } = fakeComposio(fakes);
  await client.linkWithKey("cloudflare", "owner", [
    { name: "generic_api_key", value: "global-key-1" },
    { name: "generic_id", value: "owner@example.com" },
  ]);
  assert.deepEqual(calls.at(-1)?.body, {
    auth_config: { id: "ac_new" },
    connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { generic_api_key: "global-key-1", generic_id: "owner@example.com" } } },
  });
  // one of them missing: the card is asked for that one again, by the name the provider gives it
  await assert.rejects(client.linkWithKey("cloudflare", "owner", [{ name: "generic_api_key", value: "global-key-1" }]), (e) => e instanceof CannotLink && e.why === "key" && e.label === "Cloudflare Account Email");
});

test("an existing custom auth config for the key is reused", async () => {
  const { client, calls } = fakeComposio(fakes, [{ id: "ac_oauth", auth_scheme: "OAUTH2" }, { id: "ac_key", auth_scheme: "API_KEY" }]);
  await client.linkWithKey("cloudflare_api_key", "owner", [{ name: "generic_api_key", value: "k" }]);
});

test("a key the provider turns down says so, and the key is in no message", async () => {
  const { client } = fakeComposio(fakes, [], true);
  await assert.rejects(client.linkWithKey("cloudflare_api_key", "owner", [{ name: "generic_api_key", value: "bad-token-2" }]), (e) => e instanceof CannotLink && e.why === "rejected" && !e.message.includes("bad-token-2"));
  await assert.rejects(fakeComposio(fakes).client.linkWithKey("gmail", "owner", [{ name: "generic_api_key", value: "k" }]), (e) => e instanceof CannotLink && e.why === "managed");
});

test("the directory tells the app how an app connects, and passes a key on", async () => {
  const { client, calls } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => list }, { userId: "owner", rules: memoryRules() });
  assert.deepEqual(await directory.access("gmail"), { kind: "managed" });
  assert.deepEqual(await directory.access("cloudflare_api_key"), { kind: "key", fields: [{ name: "generic_api_key", label: "Cloudflare API Token", secret: true }] });
  await assert.rejects(directory.access("twitter"), CannotLink);
  await directory.connectKey("cloudflare_api_key", [{ name: "generic_api_key", value: "k" }]);
  assert.equal(calls.at(-1)?.path, "/api/v3.1/connected_accounts");
});

test("only what Amuse can connect is offered; anything it cannot make sense of stays", () => {
  assert.equal(offeredInDirectory(["OAUTH2"], ["OAUTH2"]), true, "Composio hosts that login");
  assert.equal(offeredInDirectory(["OAUTH2", "API_KEY"], ["OAUTH2"]), true);
  assert.equal(offeredInDirectory(["API_KEY"], []), true, "a key Amuse can ask for on a card");
  assert.equal(offeredInDirectory(["BEARER_TOKEN"], []), true);
  assert.equal(offeredInDirectory(["OAUTH2"], []), false, "your own OAuth app: the page could only say it cannot be connected");
  assert.equal(offeredInDirectory(["OAUTH1", "S2S_OAUTH2"], []), false);
  assert.equal(offeredInDirectory(["DCR_OAUTH"], []), false, "grafana_cloud_mcp and cloudflare_mcp: the MCP toolkits the owner found listed");
  assert.equal(offeredInDirectory(["BASIC"], []), false, "mixpanel: Amuse has no basic-auth form");
  assert.equal(offeredInDirectory(["NO_AUTH"], []), false);
  assert.equal(offeredInDirectory([], []), true, "nothing known about it at all: kept, and logged once when it is opened");
});

test("the directory offers what Amuse can connect: Composio's login, a key, or an unknown; not the rest", async () => {
  const { client } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => list }, { userId: "owner", rules: memoryRules() });
  const offered = async (query: string) => (await directory.search(query, null)).apps.map((a) => a.id);
  assert.deepEqual(await offered("twitter"), [], "your own OAuth app");
  assert.deepEqual(await offered("mcp"), [], "DCR_OAUTH: the MCP toolkits the owner found listed");
  assert.deepEqual(await offered("workday"), ["workday_raas"], "the sibling that takes a key is offered");
  assert.deepEqual(await offered(""), ["gmail", "cloudflare", "cloudflare_api_key", "workday_raas", "mystery"]);
});

test("the agent hears a toolkit cannot be connected here, and which sibling takes a key instead", async () => {
  const { client } = fakeComposio(fakes);
  const directory = composioDirectory({ ...client, toolkits: async () => list }, { userId: "owner", rules: memoryRules() });
  assert.equal(await directory.cannotConnect("gmail"), null, "it can be connected: nothing to say");
  assert.equal(await directory.cannotConnect("cloudflare"), null, "its two fields are a card like any other");
  assert.equal(await directory.cannotConnect("cloudflare_api_key"), null);
  const ownApp = await directory.cannotConnect("workday");
  assert.match(ownApp ?? "", /Workday cannot be connected here: it needs credentials of your own that Amuse cannot set up\. Workday RaaS \(workday_raas\) does the same job with a key or a token: ask the user for that one instead\./);
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
    await client.access("workday");
    await client.access("workday");
    await client.access("twitter");
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(
    lines.map((line) => line.replace(/^Composio toolkit \S+ cannot be classified: /, "")),
    ["managed schemes [none]; schemes OAUTH2 [full, client_id, client_secret]", "managed schemes [none]; schemes OAUTH2 [client_id, client_secret]"],
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
