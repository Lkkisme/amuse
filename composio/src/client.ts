/**
 * The few Composio REST calls remuse needs (v3, developer `ak_` key sent as
 * x-api-key). Responses are parsed with zod here, so a changed API fails
 * loudly at the boundary instead of leaking `undefined` inward.
 */
import { z } from "zod";

export const composioBase = "https://backend.composio.dev/api/v3";

export class ComposioError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

const AuthConfigs = z.object({ items: z.array(z.object({ id: z.string() })) });
const CreatedAuthConfig = z.object({ auth_config: z.object({ id: z.string() }) });
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
}

export interface Composio {
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
  accounts(userId: string, toolkit?: string): Promise<{ id: string; toolkit: string; status: string; label: string | null }[]>;
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
  async function call<T>(schema: z.ZodType<T>, path: string, init: { method?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const url = new URL(composioBase + path);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const response = await http(url, {
      method: init.method ?? "GET",
      headers: { "x-api-key": apiKey, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new ComposioError(`Composio ${init.method ?? "GET"} ${path} failed (${response.status})`, response.status);
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

  return {
    async link(toolkit, userId, callbackUrl) {
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
          all.push({ slug: t.slug, name: t.name, description: t.meta.description, logo, categories: t.meta.categories.map((c) => c.name) });
        }
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      return all;
    },
    async accounts(userId, toolkit) {
      const query = { user_ids: userId, limit: "100", ...(toolkit ? { toolkit_slugs: toolkit } : {}) };
      const { items } = await call(ConnectedAccounts, "/connected_accounts", { query });
      return items.map((a) => ({ id: a.id, toolkit: a.toolkit.slug, status: a.status.toUpperCase(), label: labelOf(a.data) }));
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
 * How the user sets apps up, for the agent to walk them through (in its own
 * words, in theirs): it needs their own Composio API key. Per Composio's docs:
 * Settings › Project Settings › API Keys on dashboard.composio.dev.
 */
export const composioGuide = [
  "Apps are not set up yet: connecting them (mail, calendar, sheets, ...) needs the user's own Composio API key. Composio is the service that connects apps for this assistant; the user's app logins stay with it.",
  "Walk the user through it, a step at a time, in plain words: 1) sign in or sign up at dashboard.composio.dev; 2) open Settings, then Project Settings; 3) under API Keys, copy the key (it starts with ak_); 4) here, open Settings, then Connectors, choose Add Composio key and paste it; the app tests it at once.",
  "Once the key is added, try again. Never ask the user to paste the key into the chat: it goes only in Settings.",
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
