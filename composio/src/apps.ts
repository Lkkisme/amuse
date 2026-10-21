/**
 * The agent's connected apps on Composio, for one Composio user, under the
 * user's rules (core/policy.ts): each tool comes with what the agent may do
 * with it. A tool the user denied is still listed as such: the agent knows it
 * is there (not that there is nothing), and calling it is refused.
 */
import { type Rules, kindOf, kindByName, permissionOf } from "@amuse/core";
import type { Permission, ToolKind } from "@amuse/protocol";
import type { Composio } from "./client.ts";

export function composioApps(client: Composio, userId: string, rules: Rules) {
  /** tools' kinds, learned as they are seen */
  const kinds = new Map<string, ToolKind>();
  const kind = async (slug: string): Promise<ToolKind> => {
    const known = kinds.get(slug);
    if (known) return known;
    // a tool Composio does not know of is judged by its name (anything not plainly a read is asked about)
    const learned = await client.tool(slug).then((t) => kindOf(t.slug, t.tags), () => kindByName(slug));
    kinds.set(slug, learned);
    return learned;
  };
  return {
    /** The app's accounts that work now. */
    accounts: async (app: string) =>
      (await client.accounts(userId, app)).filter((a) => a.status === "ACTIVE").map((a) => ({ id: a.id, label: a.label })),
    /** Tools matching `query`, each with what the agent may do with it. */
    async tools(app: string, query: string) {
      const [found, chosen] = await Promise.all([client.tools(app, query), rules.of(app)]);
      return found.flatMap((t) => {
        const k = kindOf(t.slug, t.tags);
        kinds.set(t.slug, k);
        return [{ ...t, permission: permissionOf(k, chosen) }];
      });
    },
    kind,
    permission: async (app: string, slug: string): Promise<Permission> => permissionOf(await kind(slug), await rules.of(app)),
    /** Keep the user's answer for next time ("always"): for the app's tools of this one's kind. */
    remember: async (app: string, slug: string, permission: Permission) => rules.set(app, await kind(slug), permission),
    call: (slug: string, args: Record<string, unknown>, account: string) => client.execute(slug, userId, args, account),
    /** A web search (Composio's own, no account). */
    search: (query: string) => client.search(userId, query),
  };
}
