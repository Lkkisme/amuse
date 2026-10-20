/** The agent's connected apps on Composio, for one Composio user. */
import type { Composio } from "./client.ts";

export function composioApps(client: Composio, userId: string) {
  return {
    connected: (app: string) => client.connected(app, userId),
    tools: (app: string, query: string) => client.tools(app, query),
    call: (slug: string, args: Record<string, unknown>) => client.execute(slug, userId, args),
  };
}
