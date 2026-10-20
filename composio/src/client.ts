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

export type AccountStatus = "active" | "pending" | "failed";

export interface Composio {
  /** A hosted link where the user authorizes `toolkit`; the account it will create. */
  link(toolkit: string, userId: string, callbackUrl?: string): Promise<{ url: string; account: string }>;
  status(account: string): Promise<AccountStatus>;
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
