/**
 * The agent's tools. Each one is an AgentAction sent through the core's
 * rules; the tool only translates arguments in and the outcome back out.
 * Both return at once: the work shows up as a card and continues in the
 * background while the chat goes on.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, consequential } from "@remuse/core";
import { Type } from "typebox";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });

/** Tools bound to the agent IO of the run in progress. */
export function tools(io: () => AgentIO): ToolDefinition[] {
  return [
    defineTool({
      name: "browse",
      label: "Browser task",
      description:
        "Start a task in a real browser: opening sites, reading pages, filling forms, logging in. It runs in the background and the user can watch or take over. Returns immediately; do not wait for it.",
      parameters: Type.Object({
        title: Type.String({ description: "Short task title the user will see, e.g. 'Check the tide schedule'" }),
        url: Type.String({ description: "Absolute http(s) URL to start from" }),
      }),
      async execute(_, { title, url }) {
        if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return text(`Not started: "${url}" is not an http(s) URL.`);
        const result = io().act({ kind: "browse", title, url });
        return text(result.ok ? `Started browser task ${result.id}. The user sees it as a card; it continues in the background.` : `Not started: ${result.reason}.`);
      },
    }),
    defineTool({
      name: "request_connection",
      label: "Connect an app",
      description:
        "Ask the user to connect an app (Gmail, Google Calendar, Google Sheets, GitHub, Slack, ...) when a request needs data or actions from it. Shows a Connect card in the chat and returns immediately.",
      parameters: Type.Object({
        provider: Type.String({ description: "Lowercase provider id, e.g. 'gmail', 'googlesheets'" }),
        title: Type.String({ description: "App name as the user knows it, e.g. 'Google Sheets'" }),
      }),
      async execute(_, { provider, title }) {
        const result = io().act({ kind: "connect", provider, title });
        return text(result.ok ? `Asked the user to connect ${title}. Continue once they have.` : `Could not ask: ${result.reason}.`);
      },
    }),
  ];
}

/** A connected-apps provider (Composio implements it). */
export interface Apps {
  connected(app: string): Promise<boolean>;
  tools(app: string, query: string): Promise<{ slug: string; name: string; description: string; parameters: Record<string, unknown>; required: string[] }[]>;
  call(slug: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** GMAIL_SEND_EMAIL → gmail, the app an action belongs to. */
const appOf = (slug: string) => slug.split("_")[0]?.toLowerCase() ?? "";

/** Find and use actions of the user's connected apps; consequential ones need approval. */
export function appTools(io: () => AgentIO, apps: Apps): ToolDefinition[] {
  const notConnected = (app: string) => text(`${app} is not connected. Call request_connection for it first.`);
  return [
    defineTool({
      name: "app_tools",
      label: "Look up app actions",
      description: "Find actions of a connected app (e.g. app 'gmail', query 'latest emails'). Returns action slugs with their arguments.",
      parameters: Type.Object({ app: Type.String({ description: "Lowercase app id, e.g. gmail, googlecalendar, googlesheets, github" }), query: Type.String() }),
      async execute(_, { app, query }) {
        if (!(await apps.connected(app))) return notConnected(app);
        const found = await apps.tools(app, query);
        if (found.length === 0) return text(`No ${app} actions match "${query}".`);
        return text(
          found
            .map((t) => `- ${t.slug}: ${clip(t.description, 300)}\n  args: ${clip(JSON.stringify(t.parameters), 700)}\n  required: ${t.required.join(", ") || "none"}`)
            .join("\n"),
        );
      },
    }),
    defineTool({
      name: "app_call",
      label: "Use an app",
      description:
        "Run an app action found with app_tools. Reading runs at once. Actions that send, change, delete or pay are posted for the user's approval and run in the background once approved; you will get a report.",
      parameters: Type.Object({ action: Type.String({ description: "Action slug, e.g. GMAIL_FETCH_EMAILS" }), arguments: Type.Record(Type.String(), Type.Unknown()) }),
      async execute(_, { action, arguments: args }) {
        const app = appOf(action);
        if (!(await apps.connected(app))) return notConnected(app);
        const outcome = (r: Awaited<ReturnType<Apps["call"]>>) => (r.ok ? clip(JSON.stringify(r.data), 12_000) : `failed: ${r.error}`);
        if (!consequential(action)) return text(outcome(await apps.call(action, args)));
        // never hold the chat for an approval: ask, return, and finish in the background
        const agent = io();
        const label = action.replaceAll("_", " ").toLowerCase();
        const asked = agent.act({ kind: "ask", action: label, target: app, detail: clip(JSON.stringify(args), 400) });
        if (!asked.ok) return text(`Could not ask for approval: ${asked.reason}.`);
        void agent.decision(asked.id).then(async (verdict) => {
          if (verdict === "denied") return agent.report(`[app action "${label}" declined by the user]`);
          const result = await apps.call(action, args).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
          agent.report(`[app action "${label}" ${outcome(result)}]`);
        });
        return text("Posted for the user's approval. It runs once they approve; you will get a report. Tell the user briefly.");
      },
    }),
  ];
}
