/**
 * The few Composio REST calls amuse needs (v3, developer `ak_` key sent as
 * x-api-key). Responses are parsed with zod here, so a changed API fails
 * loudly at the boundary instead of leaking `undefined` inward.
 */
import { z } from "zod";
import type { GivenField, KeyField } from "@amuse/protocol";

export const composioBase = "https://backend.composio.dev/api/v3";
/** Composio's docs give the toolkit, auth config and connected account endpoints used for keys under v3.1. */
const keyBase = "https://backend.composio.dev/api/v3.1";

export class ComposioError extends Error {
  readonly status: number | null;
  /** the request never got an answer (offline, DNS, timeout) */
  readonly network: boolean;
  /** Composio answered that the provider turned a key down (its ConnectedAccount_CredentialValidationRejected) */
  readonly rejected: boolean;
  constructor(message: string, status: number | null = null, how: { network?: boolean; rejected?: boolean } = {}) {
    super(message);
    this.status = status;
    this.network = how.network ?? false;
    this.rejected = how.rejected ?? false;
  }
}

/**
 * Why a toolkit cannot be connected the usual way: it needs the user's own key (`key`, `label` is what the provider
 * calls it), it needs credentials Amuse cannot set up (`unsupported`), it takes no key (`managed`), or the provider
 * turned the key down (`rejected`).
 */
export class CannotLink extends Error {
  readonly why: "key" | "unsupported" | "managed" | "rejected";
  readonly app: string;
  readonly label: string | null;
  constructor(why: CannotLink["why"], app: string, label: string | null = null) {
    super(`${app} cannot be connected that way (${why})`);
    this.why = why;
    this.app = app;
    this.label = label;
  }
}

const AuthConfigs = z.object({ items: z.array(z.object({ id: z.string() })) });
const CreatedAuthConfig = z.object({ auth_config: z.object({ id: z.string() }) });

/** A field group as it comes back when the response leaves it out altogether. */
const noFields = { required: [], optional: [] };

/**
 * A toolkit's auth schemes as `GET /toolkits/{slug}` sends them (the shape `@composio/client`'s
 * `ToolkitRetrieveResponse` declares): one `auth_config_details` entry per scheme, each with the fields its auth
 * config and its connected account ask for. Read leniently throughout: a response that leaves a group out is not a
 * failure, and the label is `displayName` on the wire (`display_name` is read too, in case a version sends it so).
 */
const AuthField = z.looseObject({ name: z.string(), displayName: z.string().optional(), display_name: z.string().optional(), is_secret: z.boolean().optional() });
const Fields = z.object({ required: z.array(AuthField).default([]), optional: z.array(AuthField).default([]) }).default(noFields);
const ToolkitAuth = z.object({
  name: z.string().default(""),
  slug: z.string().default(""),
  composio_managed_auth_schemes: z.array(z.string()).default([]),
  auth_config_details: z
    .array(
      z.object({
        mode: z.string().default(""),
        fields: z.object({ auth_config_creation: Fields, connected_account_initiation: Fields }).default({ auth_config_creation: noFields, connected_account_initiation: noFields }),
      }),
    )
    .default([]),
});
const KeyedAuthConfigs = z.object({ items: z.array(z.object({ id: z.string(), auth_scheme: z.string().optional() })) });
const Link = z.object({ redirect_url: z.url(), connected_account_id: z.string() });
const Account = z.object({ id: z.string(), status: z.string() });
const Accounts = z.object({ items: z.array(Account) });
const Tool = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().default(""),
  human_description: z.string().nullable().default(null),
  /** MCP hints among them: readOnlyHint, destructiveHint (see core/policy.ts) */
  tags: z.array(z.string()).default([]),
  input_parameters: z.looseObject({ properties: z.record(z.string(), z.unknown()).default({}), required: z.array(z.string()).default([]) }).default({ properties: {}, required: [] }),
});
const Tools = z.object({
  items: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().default(""),
      tags: z.array(z.string()).default([]),
      input_parameters: z.looseObject({ properties: z.record(z.string(), z.unknown()).default({}), required: z.array(z.string()).default([]) }).default({ properties: {}, required: [] }),
    }),
  ),
});
const Toolkits = z.object({
  items: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      no_auth: z.boolean().default(false),
      deprecated: z.unknown().optional(),
      /** the schemes the toolkit supports, and which of them Composio manages: enough to tell an own-OAuth-app one from the rest, without asking about each toolkit */
      auth_schemes: z.array(z.string()).default([]),
      composio_managed_auth_schemes: z.array(z.string()).default([]),
      meta: z
        .looseObject({
          description: z.string().default(""),
          logo: z.string().default(""),
          categories: z.array(z.looseObject({ name: z.string() })).default([]),
        })
        .default({ description: "", logo: "", categories: [] }),
    }),
  ),
  next_cursor: z.string().nullable().default(null),
});
/** Only what tells an account apart is read from its data; the tokens in it are never touched. */
const ConnectedAccounts = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      toolkit: z.object({ slug: z.string() }),
      created_at: z.string().nullable().default(null),
      data: z.looseObject({ displayName: z.string().optional(), email: z.string().optional(), id_token: z.string().optional() }).nullable().default(null),
    }),
  ),
});

/** The email in an OpenID id_token's claims (its middle part, base64url JSON); the token is not kept. */
const emailIn = (idToken: string): string | null => {
  const claims = z.looseObject({ email: z.string() }).safeParse(
    (() => {
      try {
        return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
      } catch {
        return null;
      }
    })(),
  );
  return claims.success ? claims.data.email : null;
};

/** What tells an account apart: its email where there is one, else its display name. */
const labelOf = (data: z.infer<typeof ConnectedAccounts>["items"][number]["data"]): string | null =>
  data?.email || (data?.id_token ? emailIn(data.id_token) : null) || data?.displayName || null;
/** Composio search's answer (Google's, through SerpAPI): only the plain results are kept. */
const SearchResults = z.object({
  results: z.object({
    organic_results: z.array(z.object({ title: z.string(), link: z.url(), snippet: z.string().default("") })).default([]),
  }),
});
const Executed = z.object({ successful: z.boolean(), data: z.unknown(), error: z.string().nullable().default(null) });

export interface AppTool {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  /** JSON Schema properties of the tool's arguments */
  parameters: Record<string, unknown>;
  required: string[];
}

export type AccountStatus = "active" | "pending" | "failed";

/** One of Composio's toolkits (an app the agent can be connected to). */
export interface Toolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  /** the schemes it supports, and which of them Composio manages (see `ownOAuthOnly`) */
  schemes: string[];
  managedSchemes: string[];
}

/**
 * How a toolkit is connected: Composio hosts the login (`managed`), the user brings credentials of their own
 * (`key`: one field, or several — Cloudflare's global key and the account email), or neither works.
 */
export type Access =
  | { kind: "managed"; name: string }
  | { kind: "key"; name: string; mode: string; fields: KeyField[] }
  | { kind: "unsupported"; name: string };

/** The schemes a key or a bearer token is pasted for: one secret field, which a card can ask for. */
const keyed = new Set(["API_KEY", "BEARER_TOKEN"]);

/** The schemes whose login is the user's own OAuth app: Composio does not host those. */
const ownOAuth = new Set(["OAUTH1", "OAUTH2", "S2S_OAUTH2"]);

/** Whether any of these schemes is one a key or a token is pasted for. */
export const takesKey = (schemes: readonly string[]): boolean => schemes.some((scheme) => keyed.has(scheme.toUpperCase()));

/**
 * Whether a toolkit's only way in is the user's own OAuth app, which Amuse cannot set up: true only when that is
 * positively so — every scheme is one of those and Composio manages none. A scheme Amuse does not know, a key or a
 * token, or anything Composio manages keeps the toolkit: an unclassified one stays visible.
 */
export const ownOAuthOnly = (schemes: readonly string[], managed: readonly string[]): boolean =>
  schemes.length > 0 && managed.length === 0 && schemes.every((scheme) => ownOAuth.has(scheme.toUpperCase()));

/**
 * One field of a key toolkit's card, as Composio describes it. A secret is one Composio marks `is_secret`, or whose
 * name says so (`generic_api_key`, `bearer_token`, `password`): those are typed as passwords. The rest — an email, an
 * account id, a subdomain — are plain.
 */
const keyFieldOf = (field: z.infer<typeof AuthField>): KeyField => ({
  name: field.name,
  label: field.displayName || field.display_name || field.name,
  secret: field.is_secret === true || /key|token|secret|password/i.test(field.name),
});

/** What a key toolkit is called in a message about it: its one field's label, or none when it takes several. */
const saidField = (fields: KeyField[]): string | null => (fields.length === 1 ? (fields[0]?.label ?? null) : null);

/** Read a toolkit's auth schemes: Composio's own login wins; else a key or token that is the only thing asked for. */
export function accessOf(toolkit: unknown): Access {
  const parsed = ToolkitAuth.parse(toolkit);
  const name = parsed.name || parsed.slug;
  if (parsed.composio_managed_auth_schemes.length > 0) return { kind: "managed", name };
  for (const scheme of parsed.auth_config_details) {
    const mode = scheme.mode.toUpperCase();
    if (!keyed.has(mode)) continue;
    const fields = scheme.fields.connected_account_initiation.required.map(keyFieldOf);
    // a key or a token, with whatever the account needs alongside it (an email, a subdomain): none of it is asked
    // for when the auth config is made
    if (fields.length > 0 && scheme.fields.auth_config_creation.required.length === 0) return { kind: "key", name, mode, fields };
  }
  return { kind: "unsupported", name };
}

/**
 * A toolkit's schemes as one line for the log: the mode names and the field names, never a value. Written once per
 * toolkit Amuse cannot classify, so the next real failure says exactly what Composio sent.
 */
export function schemeSummary(toolkit: unknown): string {
  const parsed = ToolkitAuth.safeParse(toolkit);
  if (!parsed.success) return "no toolkit response to read";
  const schemes = parsed.data.auth_config_details.map((detail) => {
    const { connected_account_initiation: initiation, auth_config_creation: creation } = detail.fields;
    const fields = [...initiation.required, ...initiation.optional, ...creation.required, ...creation.optional].map((f) => f.name);
    return `${detail.mode || "(no mode)"} [${fields.join(", ") || "no fields"}]`;
  });
  return `managed schemes [${parsed.data.composio_managed_auth_schemes.join(", ") || "none"}]; schemes ${schemes.join("; ") || "none"}`;
}

export interface Composio {
  /** How `toolkit` is connected. */
  access(toolkit: string): Promise<Access>;
  /**
   * Connect `toolkit` with the user's own `key`. Composio holds it from here (Amuse keeps it nowhere) and checks it
   * with the provider where it can; throws CannotLink("rejected") when the provider turns it down.
   */
  linkWithKey(toolkit: string, userId: string, values: GivenField[]): Promise<void>;
  /** A hosted link where the user authorizes `toolkit`; the account it will create. */
  link(toolkit: string, userId: string, callbackUrl?: string): Promise<{ url: string; account: string }>;
  status(account: string): Promise<AccountStatus>;
  /** Whether `userId` has an active account for `toolkit`. */
  connected(toolkit: string, userId: string): Promise<boolean>;
  /** Tools of a toolkit matching `search`. */
  tools(toolkit: string, search: string): Promise<AppTool[]>;
  /** One tool, by its slug. */
  tool(slug: string): Promise<AppTool>;
  /** A Google search through Composio's own search toolkit (no account needed): the plain results. */
  search(userId: string, query: string): Promise<{ title: string; url: string; snippet: string }[]>;
  /** Every toolkit there is to connect, most used first (no-auth and deprecated ones left out). */
  toolkits(): Promise<Toolkit[]>;
  /** `userId`'s accounts (of one toolkit, if given), as Composio has them (status upper-case: ACTIVE, EXPIRED, …). */
  accounts(userId: string, toolkit?: string): Promise<{ id: string; toolkit: string; status: string; label: string | null; since: string | null }[]>;
  /** Delete a connected account. */
  remove(account: string): Promise<void>;
  /** Run a tool for `userId`, as `account` when they have several; the tool's result, or its error. */
  execute(slug: string, userId: string, args: Record<string, unknown>, account?: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

const appTool = (t: z.infer<typeof Tool>): AppTool => ({
  slug: t.slug,
  name: t.name,
  description: t.human_description || t.description,
  tags: t.tags,
  parameters: t.input_parameters.properties,
  required: t.input_parameters.required,
});

export function composio(apiKey: string, http: typeof fetch = fetch): Composio {
  async function call<T>(schema: z.ZodType<T>, path: string, init: { method?: string; query?: Record<string, string>; body?: unknown; base?: string } = {}): Promise<T> {
    const url = new URL((init.base ?? composioBase) + path);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const response = await http(url, {
      method: init.method ?? "GET",
      headers: { "x-api-key": apiKey, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new ComposioError(`Composio ${init.method ?? "GET"} ${path} got no answer`, null, { network: true });
    });
    if (!response.ok) {
      // the body is read for one documented code only, never kept or shown
      const rejected = (await response.text().catch(() => "")).includes("CredentialValidationRejected");
      throw new ComposioError(`Composio ${init.method ?? "GET"} ${path} failed (${response.status})`, response.status, { rejected });
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new ComposioError(`Composio ${path} returned an unexpected shape`);
    return parsed.data;
  }

  /** The Composio-managed auth config for a toolkit, reused or created. */
  async function authConfig(toolkit: string): Promise<string> {
    const listed = await call(AuthConfigs, "/auth_configs", { query: { toolkit_slug: toolkit, is_composio_managed: "true", limit: "5" } });
    const existing = listed.items[0];
    if (existing) return existing.id;
    const created = await call(CreatedAuthConfig, "/auth_configs", {
      method: "POST",
      body: { toolkit: { slug: toolkit }, auth_config: { type: "use_composio_managed_auth" } },
    });
    return created.auth_config.id;
  }

  /**
   * A toolkit's auth schemes, asked about once: the directory and the toolkit page ask about the same ones, and a
   * failed lookup is asked again rather than kept.
   */
  const accesses = new Map<string, Promise<Access>>();
  const readAccess = (toolkit: string): Promise<Access> => {
    const known = accesses.get(toolkit);
    if (known) return known;
    const asked = (async () => {
      const response = await call(z.unknown(), `/toolkits/${encodeURIComponent(toolkit)}`, { base: keyBase });
      const access = accessOf(response);
      // once per toolkit: mode names and field names only, so the next real failure says what Composio sent
      if (access.kind === "unsupported") console.warn(`Composio toolkit ${toolkit} cannot be classified: ${schemeSummary(response)}`);
      return access;
    })();
    accesses.set(toolkit, asked);
    asked.catch(() => accesses.delete(toolkit));
    return asked;
  };

  /** A custom auth config for a toolkit's API key, reused or created. Its credentials stay empty: the key goes with each account. */
  async function keyAuthConfig(toolkit: string, name: string, mode: string): Promise<string> {
    const query = { toolkit_slug: toolkit, is_composio_managed: "false", limit: "10" };
    const listed = await call(KeyedAuthConfigs, "/auth_configs", { base: keyBase, query });
    const existing = listed.items.find((c) => c.auth_scheme?.toUpperCase() === mode);
    if (existing) return existing.id;
    const created = await call(CreatedAuthConfig, "/auth_configs", {
      base: keyBase,
      method: "POST",
      // `authScheme` is what Composio's own SDK sends for a custom auth config (the response calls it auth_scheme)
      body: { toolkit: { slug: toolkit }, auth_config: { type: "use_custom_auth", authScheme: mode, name, credentials: {} } },
    });
    return created.auth_config.id;
  }

  return {
    access: readAccess,
    async linkWithKey(toolkit, userId, values) {
      const access = await readAccess(toolkit);
      if (access.kind === "managed") throw new CannotLink("managed", access.name);
      if (access.kind === "unsupported") throw new CannotLink("unsupported", access.name);
      const val: Record<string, string> = {};
      for (const field of access.fields) {
        const given = values.find((v) => v.name === field.name)?.value;
        if (!given) throw new CannotLink("key", access.name, field.label); // asked for again, by the name the provider gives it
        val[field.name] = given;
      }
      const config = await keyAuthConfig(toolkit, access.name, access.mode);
      // Composio holds these from here: Amuse stores none of them (no file, no database, no log), it only passes them on
      const state = { authScheme: access.mode, val };
      try {
        await call(z.unknown(), "/connected_accounts", { base: keyBase, method: "POST", body: { auth_config: { id: config }, connection: { user_id: userId, state } } });
      } catch (error) {
        if (error instanceof ComposioError && error.rejected) throw new CannotLink("rejected", access.name, saidField(access.fields));
        throw error;
      }
    },
    async link(toolkit, userId, callbackUrl) {
      const access = await readAccess(toolkit);
      if (access.kind === "key") throw new CannotLink("key", access.name, saidField(access.fields));
      if (access.kind === "unsupported") throw new CannotLink("unsupported", access.name);
      const body = { auth_config_id: await authConfig(toolkit), user_id: userId, ...(callbackUrl ? { callback_url: callbackUrl } : {}) };
      const created = await call(Link, "/connected_accounts/link", { method: "POST", body });
      return { url: created.redirect_url, account: created.connected_account_id };
    },
    async connected(toolkit, userId) {
      const { items } = await call(Accounts, "/connected_accounts", { query: { user_ids: userId, toolkit_slugs: toolkit, statuses: "ACTIVE", limit: "1" } });
      return items.length > 0;
    },
    async tools(toolkit, search) {
      // Composio matches `search` as one phrase: widen to single words (longest first), then to everything
      const find = async (term: string | null) =>
        (await call(Tools, "/tools", { query: { toolkit_slug: toolkit, limit: "8", ...(term ? { search: term } : {}) } })).items;
      const words = search.split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
      let items = await find(search);
      for (const word of words) if (items.length < 8) items = [...items, ...(await find(word))];
      if (items.length === 0) items = await find(null);
      // most query words matched first
      const score = (t: (typeof items)[number]) => {
        const hay = `${t.slug} ${t.name}`.toLowerCase();
        return words.filter((w) => hay.includes(w.toLowerCase().replace(/s$/, ""))).length;
      };
      const unique = [...new Map(items.map((t) => [t.slug, t])).values()].sort((a, b) => score(b) - score(a)).slice(0, 8);
      return unique.map((t) => ({ slug: t.slug, name: t.name, description: t.description, tags: t.tags, parameters: t.input_parameters.properties, required: t.input_parameters.required }));
    },
    tool: async (slug) => appTool(await call(Tool, `/tools/${encodeURIComponent(slug)}`)),
    async search(userId, query) {
      const result = await call(Executed, "/tools/execute/COMPOSIO_SEARCH_SEARCH", { method: "POST", body: { user_id: userId, arguments: { query } } });
      if (!result.successful) throw new ComposioError(`search failed: ${result.error ?? "unknown"}`);
      const found = SearchResults.safeParse(result.data);
      return found.success ? found.data.results.organic_results.map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })) : [];
    },
    async toolkits() {
      const all: Toolkit[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 5; pages++) {
        const page: z.infer<typeof Toolkits> = await call(Toolkits, "/toolkits", { query: { sort_by: "usage", limit: "1000", ...(cursor ? { cursor } : {}) } });
        for (const t of page.items) {
          if (t.no_auth || t.deprecated === true) continue;
          const logo = URL.canParse(t.meta.logo) ? t.meta.logo : null;
          all.push({ slug: t.slug, name: t.name, description: t.meta.description, logo, categories: t.meta.categories.map((c) => c.name), schemes: t.auth_schemes, managedSchemes: t.composio_managed_auth_schemes });
        }
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      return all;
    },
    async accounts(userId, toolkit) {
      const query = { user_ids: userId, limit: "100", ...(toolkit ? { toolkit_slugs: toolkit } : {}) };
      const { items } = await call(ConnectedAccounts, "/connected_accounts", { query });
      return items.map((a) => ({ id: a.id, toolkit: a.toolkit.slug, status: a.status.toUpperCase(), label: labelOf(a.data), since: a.created_at }));
    },
    async remove(account) {
      await call(z.unknown(), `/connected_accounts/${encodeURIComponent(account)}`, { method: "DELETE" });
    },
    async execute(slug, userId, args, account) {
      const body = { user_id: userId, arguments: args, ...(account ? { connected_account_id: account } : {}) };
      const result = await call(Executed, `/tools/execute/${encodeURIComponent(slug)}`, { method: "POST", body });
      return result.successful ? { ok: true, data: result.data } : { ok: false, error: result.error ?? "the tool failed" };
    },
    async status(account) {
      const { status } = await call(Account, `/connected_accounts/${encodeURIComponent(account)}`);
      switch (status.toUpperCase()) {
        case "ACTIVE":
          return "active";
        case "FAILED":
        case "EXPIRED":
        case "INACTIVE":
          return "failed";
        default:
          return "pending";
      }
    },
  };
}

/**
 * How the user sets connections up, for the agent to walk them through (in its own
 * words, in theirs): it needs their own Composio API key. Per Composio's docs:
 * Settings › Project Settings › API Keys on dashboard.composio.dev.
 */
export const composioGuide = [
  "Connections are not set up yet: connecting services (mail, calendar, sheets, ...) needs the user's own Composio API key. Why: each service only lets in software it has approved, and Composio is approved by them, so the user need not set up each one; it is the user's own Composio account, so their logins stay in it and they can revoke them there.",
  "Walk the user through it, a step at a time, in plain words: 1) sign in or sign up at dashboard.composio.dev; 2) open Settings, then Project Settings; 3) under API Keys, copy the key (it starts with ak_); 4) then ask for the key with request_secret and provider composio: a card in the chat opens the sheet where they paste it, and the app tests it at once (the same as Settings › Connections › Add Composio key).",
  "Once the key is added, try again. Never ask the user to paste the key into the chat: it goes only on that card, or in Settings.",
].join(" ");

/** No Composio key is set up: the agent hears how the user sets one up. */
export class NoComposioKey extends Error {
  constructor() {
    super(composioGuide);
  }
}

/** A client for whichever key is set up now (`key()` is read on every call); with none, every call fails saying so. */
export function keyedComposio(key: () => string | null, http: typeof fetch = fetch): Composio {
  let current: { key: string; client: Composio } | null = null;
  const client = async () => {
    const now = key();
    if (now === null) throw new NoComposioKey();
    if (current?.key !== now) current = { key: now, client: composio(now, http) };
    return current.client;
  };
  return {
    access: async (toolkit) => (await client()).access(toolkit),
    linkWithKey: async (toolkit, userId, values) => (await client()).linkWithKey(toolkit, userId, values),
    link: async (toolkit, userId, callbackUrl) => (await client()).link(toolkit, userId, callbackUrl),
    status: async (account) => (await client()).status(account),
    connected: async (toolkit, userId) => (await client()).connected(toolkit, userId),
    tools: async (toolkit, search) => (await client()).tools(toolkit, search),
    tool: async (slug) => (await client()).tool(slug),
    search: async (userId, query) => (await client()).search(userId, query),
    toolkits: async () => (await client()).toolkits(),
    accounts: async (userId, toolkit) => (await client()).accounts(userId, toolkit),
    remove: async (account) => (await client()).remove(account),
    execute: async (slug, userId, args, account) => (await client()).execute(slug, userId, args, account),
  };
}
