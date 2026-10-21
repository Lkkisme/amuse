/**
 * The agent's tools. Each one is an AgentAction sent through the core's
 * rules; the tool only translates arguments in and the outcome back out.
 * Both return at once: the work shows up as a card and continues in the
 * background while the chat goes on.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type Rules, type Workspace, describe, siteAccess, siteOf } from "@amuse/core";
import type { Permission } from "@amuse/protocol";
import { untrusted } from "./untrusted.ts";
import { Type } from "typebox";
import { status } from "./status.ts";
import { askToVisit, notVisited, visitAnswer } from "./visits.ts";
import type { Hold } from "./runs.ts";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });

/**
 * Tools bound to the agent IO of the run in progress. `files`: the workspace, where browser tasks
 * may be given files to upload; `hold`: how a helper waits on approvals; `appsSetup`: while apps
 * are not set up, how the user sets them up (null once they are).
 */
export function tools(
  io: () => AgentIO,
  rules: Rules,
  { files, hold, appsSetup }: { files?: Workspace | undefined; hold?: Hold; appsSetup?: (() => string | null) | undefined } = {},
): ToolDefinition[] {
  return [
    defineTool({
      name: "recall",
      label: "Search the conversation",
      description:
        "Search this chat with the user, however old (what they said, what you said, browser tasks and their results); with `everywhere`, every chat. Use it when something older than what you see is needed.",
      parameters: Type.Object({
        status,
        query: Type.String({ description: "Words to look for" }),
        everywhere: Type.Optional(Type.Boolean({ description: "Search every chat, not just this one" })),
      }),
      async execute(_, { query, everywhere }) {
        return text(io().recall(query, everywhere === true));
      },
    }),
    defineTool({
      name: "browse",
      label: "Browser task",
      description:
        "Start a task in a real browser: opening sites, reading pages, filling forms, logging in. It runs in the background and the user can watch or take over. Returns immediately; do not wait for it.",
      parameters: Type.Object({ status,
        title: Type.String({ description: "Short task title the user will see, e.g. 'Check the tide schedule'" }),
        url: Type.Optional(Type.String({ description: "Absolute http(s) URL to start from, for a new browser" })),
        browser: Type.Optional(
          Type.String({
            description:
              "To go on in a browser that is still open and idle (its id, b-…; the user's own included): its agent remembers what happened there. Leave out to open a new browser.",
          }),
        ),
        instructions: Type.String({
          description:
            "Everything the browser agent must know, in full: what to do, what to bring back, and every limit the user set (e.g. 'open it but do not fill or submit anything'). It sees nothing of the chat but this.",
        }),
        files: Type.Optional(
          Type.Array(Type.String(), {
            description: "Workspace files the task may upload to the site (e.g. 'user/cv.pdf'), only the ones it needs; each upload still asks the user. What it downloads lands in downloads/.",
          }),
        ),
      }),
      async execute(_, { title, url, browser, instructions, files: given }) {
        const granted = [...new Set(given ?? [])];
        if (granted.length > 0 && !files) return text("Not started: no files are kept here to give it.");
        for (const path of granted) if (!(await files?.exists(path))) return text(`Not started: there is no ${path} in the workspace.`);
        // a next job for a browser that is open: the same browser, the same agent
        if (browser) {
          const given = io().act({ kind: "browserJob", id: browser, title, instructions, files: granted });
          return text(given.ok ? `Given to browser ${browser}; it goes on there in the background.` : `Not given: ${describe(given.rejection)}.`);
        }
        if (!url || !URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return text(`Not started: "${url ?? ""}" is not an http(s) URL.`);
        const access = siteAccess(await rules.sites(), url);
        if (access === "deny") return text(`Not started: the user does not allow ${siteOf(url)}. Tell them; do not try another way to reach it.`);
        const agent = io();
        const start = () => agent.act({ kind: "browse", title, url, instructions, files: granted });
        if (access === "unlisted") {
          // a site with no rule is not visited until the user allows it: ask, and start once they do
          const asked = askToVisit(agent, url, `For a browser task: ${title}`);
          if (!asked.ok) return text(`Not started: ${describe(asked.rejection)}.`);
          if (hold) {
            // a helper holds here until the user answers
            hold.waiting(`to visit ${siteOf(url)} for a browser task: ${title}`);
            const outcome = await visitAnswer(agent, rules, asked.id, url);
            hold.working();
            if (outcome !== "approved") return text(`Not started: ${notVisited(url, outcome)}`);
            const started = start();
            return text(started.ok ? `Started browser task ${started.id}; you get its result as a message.` : `Not started: ${describe(started.rejection)}.`);
          }
          void visitAnswer(agent, rules, asked.id, url).then((outcome) => {
            if (outcome !== "approved") return agent.report(`[browser task "${title}" not started] ${notVisited(url, outcome)}`);
            const started = start();
            if (!started.ok) agent.report(`[browser task "${title}" not started] ${describe(started.rejection)}`);
          });
          return text(`${siteOf(url)} has no rule yet, so the user is asked first; the task starts once they allow it. Tell the user briefly that you need their OK.`);
        }
        const result = start();
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
        // before apps are set up, the card leads to the settings where their key goes
        const setup = appsSetup?.();
        if (result.ok && setup)
          return text(`Showed a Connect card for ${title}. Apps are not set up yet, so tapping it opens the settings where the Composio key goes; once the key is in, the same card connects ${title}. ${setup}`);
        return text(result.ok ? `Asked the user to connect ${title}. Continue once they have.` : `Could not ask: ${describe(result.rejection)}.`);
      },
    }),
  ];
}

/** Looking at the user's other chats: the main chat and side chats. */
export function chatTools(io: () => AgentIO): ToolDefinition[] {
  return [
    defineTool({
      name: "list_chats",
      label: "Look at your chats",
      description: "The user's chats: the main chat and side chats, with their titles and when each was last used.",
      parameters: Type.Object({ status }),
      async execute() {
        const agent = io();
        return text(agent.chats().map((c) => `- ${c.id}: ${c.title}${c.id === agent.chat ? " (this chat)" : ""}, last used ${c.updated}`).join("\n"));
      },
    }),
    defineTool({
      name: "read_chat",
      label: "Read another chat",
      description: "Read another of the user's chats by its id (from list_chats; the main chat is 'main'): its recent part in full, older parts in brief.",
      parameters: Type.Object({ status, chat: Type.String() }),
      async execute(_, { chat }) {
        return text(io().readChat(chat) ?? `There is no chat ${chat}.`);
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
export function appTools(io: () => AgentIO, apps: Apps, hold?: Hold): ToolDefinition[] {
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
                `- ${t.slug}${t.permission === "ask" ? " (asks the user first)" : t.permission === "deny" ? " (the user's rule says no to this kind: calling it asks them with a card, only do so when their request needs it)" : ""}: ${clip(t.description, 300)}\n  args: ${clip(JSON.stringify(t.parameters), 700)}\n  required: ${t.required.join(", ") || "none"}`,
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
        summary: Type.String({
          description:
            "What this does, as the user would say it, in their language: one plain line with the specifics (e.g. 'Create the event “Team sync” tomorrow at 9:00'). It titles the approval card when one is needed.",
        }),
        account: Type.Optional(Type.String({ description: "Which account (its email or id), when the app has several" })),
      }),
      execute: async (_, { action, arguments: args, summary, account }) => text(await appCall(io(), apps, action, args, summary, account, hold)),
    }),
  ];
}

/**
 * Run an app action as the user's rules say (core/policy.ts): not at all,
 * at once, or once they approve (in the background; the agent gets a report),
 * keeping an answer meant for always. Returns what the agent is told now.
 */
/** "start_datetime" → "Start datetime", "threadId" → "Thread id": a field's name as a person reads it. */
const fieldName = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** An action's arguments as the user reads them on its card: one "Field: value" a line, empty ones left out. */
export function readable(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${fieldName(key)}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

export async function appCall(
  io: AgentIO,
  apps: Apps,
  action: string,
  args: Record<string, unknown>,
  summary: string,
  asked: string | undefined,
  hold?: Hold,
): Promise<string> {
  const app = appOf(action);
  const chosen = pick(app, await apps.accounts(app), asked);
  if (!chosen.ok) return chosen.text;
  const { account } = chosen;
  type Result = Awaited<ReturnType<Apps["call"]>>;
  const outcome = (r: Result) => untrusted(r.ok ? clip(JSON.stringify(r.data), 12_000) : `failed: ${r.error}`);
  // the user's rules, not the agent, decide what runs (core/policy.ts)
  const permission = await apps.permission(app, action);
  if (permission === "allow") return outcome(await apps.call(action, args, account.id));
  // never hold the chat for an approval: ask, return, and finish in the background
  const label = action.replaceAll("_", " ").toLowerCase();
  // a kind the user said no to is still theirs to allow, on the card: once, or from now on
  const ruled = permission === "deny" ? "Your rule for this app says no to this kind of action. Allow it this time, or always?\n\n" : "";
  const approval = io.act({
    kind: "ask",
    // the card says what will happen in the user's words, as which account, and every argument, readably
    action: summary.trim() || label,
    target: account.label ?? app,
    // the user approves exactly what will run (a huge argument, e.g. an attachment, is cut and says so)
    detail: ruled + clip(readable(args), 20_000),
    remember: true, // an answer for always holds for the app's actions of this kind
  });
  if (!approval.ok) return `Could not ask for approval: ${describe(approval.rejection)}.`;
  if (hold) {
    // a helper holds here until the user answers, then goes on with the result
    hold.waiting(`to ${label} as ${account.label ?? app}`);
    const { verdict, remember } = await io.decision(approval.id);
    hold.working();
    if (remember) await apps.remember(app, action, verdict === "approved" ? "allow" : "deny").catch(() => {});
    if (verdict !== "approved") return `Not done: the user ${verdict === "denied" ? "declined it" : "did not answer in time"}. Do not try another way.`;
    return outcome(await apps.call(action, args, account.id).catch((e: unknown): Result => ({ ok: false, error: String(e) })));
  }
  void io.decision(approval.id).then(async ({ verdict, remember }) => {
    if (remember) await apps.remember(app, action, verdict === "approved" ? "allow" : "deny").catch(() => {});
    if (verdict === "denied") return io.report(`[app action "${label}" declined by the user]`);
    if (verdict === "timed_out") return io.report(`[app action "${label}" not done: the user did not answer the approval in time]`);
    const result = await apps.call(action, args, account.id).catch((e: unknown): Result => ({ ok: false, error: String(e) }));
    io.report(`[app action "${label}" done]\n${outcome(result)}`);
  });
  return "NOT done yet: it waits for the user's OK on the approval card shown in the chat. Tell them it waits for their OK; do not say it is done. You get a report once it runs.";
}
