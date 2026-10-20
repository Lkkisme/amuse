/** The agent's connected apps on Composio, for one Composio user. */
import type { Composio } from "./client.ts";

export function composioApps(client: Composio, userId: string) {
  return {
    /** The app's accounts that work now. */
    accounts: async (app: string) =>
      (await client.accounts(userId, app)).filter((a) => a.status === "ACTIVE").map((a) => ({ id: a.id, label: a.label })),
    tools: (app: string, query: string) => client.tools(app, query),
    call: (slug: string, args: Record<string, unknown>, account: string) => client.execute(slug, userId, args, account),
  };
}
