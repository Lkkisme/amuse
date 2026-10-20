/**
 * The agent's tools. Each one is an AgentAction sent through the core's
 * rules; the tool only translates arguments in and the outcome back out.
 * Both return at once: the work shows up as a card and continues in the
 * background while the chat goes on.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentIO } from "@remuse/core";
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
