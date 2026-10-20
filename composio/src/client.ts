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
const Tools = z.object({
  items: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().default(""),
      input_parameters: z.looseObject({ properties: z.record(z.string(), z.unknown()).default({}), required: z.array(z.string()).default([]) }).default({ properties: {}, required: [] }),
    }),
  ),
});
const Executed = z.object({ successful: z.boolean(), data: z.unknown(), error: z.string().nullable().default(null) });

export interface AppTool {
  slug: string;
  name: string;
  description: string;
  /** JSON Schema properties of the tool's arguments */
  parameters: Record<string, unknown>;
  required: string[];
}

export type AccountStatus = "active" | "pending" | "failed";

export interface Composio {
  /** A hosted link where the user authorizes `toolkit`; the account it will create. */
  link(toolkit: string, userId: string, callbackUrl?: string): Promise<{ url: string; account: string }>;
  status(account: string): Promise<AccountStatus>;
  /** Whether `userId` has an active account for `toolkit`. */
  connected(toolkit: string, userId: string): Promise<boolean>;
  /** Tools of a toolkit matching `search`. */
  tools(toolkit: string, search: string): Promise<AppTool[]>;
  /** Run a tool for `userId`; the tool's result, or its error. */
  execute(slug: string, userId: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

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
      return unique.map((t) => ({ slug: t.slug, name: t.name, description: t.description, parameters: t.input_parameters.properties, required: t.input_parameters.required }));
    },
    async execute(slug, userId, args) {
      const result = await call(Executed, `/tools/execute/${encodeURIComponent(slug)}`, { method: "POST", body: { user_id: userId, arguments: args } });
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
