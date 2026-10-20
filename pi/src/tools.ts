/**
 * The agent's tools. Each one is an AgentAction sent through the core's
 * rules; the tool only translates arguments in and the outcome back out.
 * Both return at once: the work shows up as a card and continues in the
 * background while the chat goes on.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type Rules, describe, siteOf, sitePermission } from "@remuse/core";
import type { Permission } from "@remuse/protocol";
import { untrusted } from "./untrusted.ts";
import { Type } from "typebox";
import { status } from "./status.ts";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });

/** Tools bound to the agent IO of the run in progress. */
export function tools(io: () => AgentIO, rules: Rules): ToolDefinition[] {
  return [
    defineTool({
      name: "recall",
      label: "Search the conversation",
      description:
        "Search the whole conversation with the user, however old (what they said, what you said, browser tasks and their results). Use it when something older than what you see is needed.",
      parameters: Type.Object({ status, query: Type.String({ description: "Words to look for" }) }),
      async execute(_, { query }) {
        return text(io().recall(query));
      },
    }),
    defineTool({
      name: "browse",
      label: "Browser task",
      description:
        "Start a task in a real browser: opening sites, reading pages, filling forms, logging in. It runs in the background and the user can watch or take over. Returns immediately; do not wait for it.",
      parameters: Type.Object({ status,
        title: Type.String({ description: "Short task title the user will see, e.g. 'Check the tide schedule'" }),
        url: Type.String({ description: "Absolute http(s) URL to start from" }),
        instructions: Type.String({
          description:
            "Everything the browser agent must know, in full: what to do, what to bring back, and every limit the user set (e.g. 'open it but do not fill or submit anything'). It sees nothing of the chat but this.",
        }),
      }),
      async execute(_, { title, url, instructions }) {
        if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return text(`Not started: "${url}" is not an http(s) URL.`);
        if (sitePermission(await rules.sites(), url) === "deny") return text(`Not started: the user does not allow ${siteOf(url)}. Tell them; do not try another way to reach it.`);
        const result = io().act({ kind: "browse", title, url, instructions });
        return text(result.ok ? `Started browser task ${result.id}. The user sees it as a card; it continues in the background.` : `Not started: ${describe(result.rejection)}.`);
      },
    }),
    defineTool({
      name: "request_connection",
      label: "Connect an app",
      description:
        "Ask the user to connect an app (Gmail, Google Calendar, Google Sheets, GitHub, Slack, ...) when a request needs data or actions from it. Shows a Connect card in the chat and returns immediately.",
      parameters: Type.Object({ status,
        provider: Type.String({ description: "Lowercase provider id, e.g. 'gmail', 'googlesheets'" }),
        title: Type.String({ description: "App name as the user knows it, e.g. 'Google Sheets'" }),
      }),
      async execute(_, { provider, title }) {
        const result = io().act({ kind: "connect", provider, title });
        return text(result.ok ? `Asked the user to connect ${title}. Continue once they have.` : `Could not ask: ${describe(result.rejection)}.`);
      },
    }),
  ];
}

/** A connected-apps provider (Composio implements it). */
export interface Apps {
  /** The app's working accounts (an app may have several: two Gmail addresses). */
  accounts(app: string): Promise<{ id: string; label: string | null }[]>;
  /** Tools matching `query`; none the user denied; each with what the agent may do with it. */
  tools(
    app: string,
    query: string,
  ): Promise<{ slug: string; name: string; description: string; parameters: Record<string, unknown>; required: string[]; permission: Permission }[]>;
  /** What the agent may do with a tool, under the user's rules. */
  permission(app: string, slug: string): Promise<Permission>;
  /** Keep an answer the user meant for next time. */
  remember(app: string, slug: string, permission: Permission): Promise<void>;
  call(slug: string, args: Record<string, unknown>, account: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

type AppAccount = Awaited<ReturnType<Apps["accounts"]>>[number];
const named = (a: AppAccount) => a.label ?? a.id;

/**
 * The account to act as: the one there is, or the one asked for (by label or id).
 * Text for the agent when that does not settle it.
 */
export function pick(app: string, accounts: AppAccount[], asked: string | undefined): { ok: true; account: AppAccount } | { ok: false; text: string } {
  if (accounts.length === 0) return { ok: false, text: `${app} is not connected. Call request_connection for it first.` };
  const wanted = asked?.trim().toLowerCase();
  if (wanted) {
    const found = accounts.find((a) => a.id.toLowerCase() === wanted || a.label?.toLowerCase() === wanted);
    return found ? { ok: true, account: found } : { ok: false, text: `No ${app} account "${asked}". Its accounts: ${accounts.map(named).join(", ")}.` };
  }
  const only = accounts[0];
  if (accounts.length === 1 && only) return { ok: true, account: only };
  return { ok: false, text: `${app} has several accounts: ${accounts.map(named).join(", ")}. Pass \`account\`; ask the user which if it is not clear.` };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** GMAIL_SEND_EMAIL → gmail, the app an action belongs to. */
const appOf = (slug: string) => slug.split("_")[0]?.toLowerCase() ?? "";

/** Find and use actions of the user's connected apps; consequential ones need approval. */
export function appTools(io: () => AgentIO, apps: Apps): ToolDefinition[] {
  return [
    defineTool({
      name: "app_tools",
      label: "Look up app actions",
      description: "Find actions of a connected app (e.g. app 'gmail', query 'latest emails'). Returns action slugs with their arguments.",
      parameters: Type.Object({ status, app: Type.String({ description: "Lowercase app id, e.g. gmail, googlecalendar, googlesheets, github" }), query: Type.String() }),
      async execute(_, { app, query }) {
        const accounts = await apps.accounts(app);
        if (accounts.length === 0) return text(`${app} is not connected. Call request_connection for it first.`);
        const found = await apps.tools(app, query);
        if (found.length === 0) return text(`No ${app} actions match "${query}".`);
        const which = accounts.length > 1 ? `\n\n${app} accounts: ${accounts.map(named).join(", ")} (pass \`account\` to app_call).` : "";
        return text(
          found
            .map(
              (t) =>
                `- ${t.slug}${t.permission === "ask" ? " (asks the user first)" : ""}: ${clip(t.description, 300)}\n  args: ${clip(JSON.stringify(t.parameters), 700)}\n  required: ${t.required.join(", ") || "none"}`,
            )
            .join("\n") + which,
        );
      },
    }),
    defineTool({
      name: "app_call",
      label: "Use an app",
      description:
        "Run an app action found with app_tools. What the user allows runs at once; what they want asked about is posted for their approval and runs in the background once approved (you will get a report); what they do not allow does not run.",
      parameters: Type.Object({
        status,
        action: Type.String({ description: "Action slug, e.g. GMAIL_FETCH_EMAILS" }),
        arguments: Type.Record(Type.String(), Type.Unknown()),
        account: Type.Optional(Type.String({ description: "Which account (its email or id), when the app has several" })),
      }),
      execute: async (_, { action, arguments: args, account }) => text(await appCall(io(), apps, action, args, account)),
    }),
  ];
}

/**
 * Run an app action as the user's rules say (core/policy.ts): not at all,
 * at once, or once they approve (in the background; the agent gets a report),
 * keeping an answer meant for always. Returns what the agent is told now.
 */
export async function appCall(io: AgentIO, apps: Apps, action: string, args: Record<string, unknown>, asked: string | undefined): Promise<string> {
  const app = appOf(action);
  const chosen = pick(app, await apps.accounts(app), asked);
  if (!chosen.ok) return chosen.text;
  const { account } = chosen;
  type Result = Awaited<ReturnType<Apps["call"]>>;
  const outcome = (r: Result) => untrusted(r.ok ? clip(JSON.stringify(r.data), 12_000) : `failed: ${r.error}`);
  // the user's rules, not the agent, decide what runs (core/policy.ts)
  const permission = await apps.permission(app, action);
  if (permission === "deny") return `The user does not allow this kind of ${app} action. Do not try to do it another way; tell the user.`;
  if (permission === "allow") return outcome(await apps.call(action, args, account.id));
  // never hold the chat for an approval: ask, return, and finish in the background
  const label = action.replaceAll("_", " ").toLowerCase();
  const approval = io.act({
    kind: "ask",
    action: label,
    // ...as which account
    target: account.label ? `${app} (${account.label})` : app,
    // the user approves exactly what will run: every argument (a huge one, e.g. an attachment, is cut and says so)
    detail: clip(JSON.stringify(args, null, 2), 20_000),
    remember: true, // an answer for always holds for the app's actions of this kind
  });
  if (!approval.ok) return `Could not ask for approval: ${describe(approval.rejection)}.`;
  void io.decision(approval.id).then(async ({ verdict, remember }) => {
    if (remember) await apps.remember(app, action, verdict === "approved" ? "allow" : "deny").catch(() => {});
    if (verdict === "denied") return io.report(`[app action "${label}" declined by the user]`);
    const result = await apps.call(action, args, account.id).catch((e: unknown): Result => ({ ok: false, error: String(e) }));
    io.report(`[app action "${label}" done]\n${outcome(result)}`);
  });
  return "Posted for the user's approval. It runs once they approve; you will get a report. Tell the user briefly.";
}
