/**
 * The chat agent's look at a browser: the page a browser task is on, as it is now, so it
 * answers about the task from the screen rather than from memory. Read-only: nothing here
 * clicks, types or navigates, and what the page says reaches the agent as untrusted data.
 * Changing anything in a browser stays with the browser agent (message_run).
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import type { Browsers, PageView } from "@amuse/browser";
import { Type } from "typebox";
import type { ImageContent } from "./attachments.ts";
import { type PiModelConfig, seesImages } from "./session.ts";
import { status } from "./status.ts";
import { untrusted } from "./untrusted.ts";

/** What the chat agent may do with a browser: look at it, and nothing else. */
export type BrowserLook = Pick<Browsers, "look" | "screenshot">;

/** Characters of a page's text given to the chat agent at once. */
const snapshot = 8_000;

type Result = { content: ({ type: "text"; text: string } | ImageContent)[]; details: null };
const say = (text: string): Result => ({ content: [{ type: "text", text }], details: null });

/** The page as the chat agent reads it: where it is, and what is on it (a site's own words: data, never instructions). */
function page(view: PageView): string {
  const text = view.text.length > snapshot ? `${view.text.slice(0, snapshot)}\n… (truncated)` : view.text;
  return untrusted(`${view.title}\n${view.url}\n\n${text}`);
}

/** A picture of the page, where the chat's model sees pictures (the browser's screenshot, the same one its card shows). */
async function shot(cfg: PiModelConfig, browsers: BrowserLook, task: string): Promise<ImageContent[]> {
  if (!(await seesImages(cfg))) return [];
  const image = await browsers.screenshot(task).catch(() => null);
  return image === null ? [] : [{ type: "image", data: Buffer.from(image).toString("base64"), mimeType: "image/png" }];
}

/** The chat agent's read-only look at a browser a task is using: the page it is on now. */
export async function readBrowser(cfg: PiModelConfig, browsers: BrowserLook, task: string): Promise<Result> {
  const view = await browsers.look(task).catch(() => null);
  if (!view) return say(`There is no browser open for ${task}.`);
  return { content: [{ type: "text", text: page(view) }, ...(await shot(cfg, browsers, task))], details: null };
}

/** The chat agent's read-only look at a browser a task is using. */
export function browserReadTools(cfg: PiModelConfig, browsers: BrowserLook): ToolDefinition[] {
  return [
    defineTool({
      name: "read_browser",
      label: "Look at the browser",
      description:
        "Look at the page a browser task is on now: its title, its URL and its visible text. Read-only: you cannot click, type or go anywhere in it. To change something there, tell the browser agent with `message_run`.",
      parameters: Type.Object({
        status,
        task: Type.String({ description: "The browser task's id (b-…), as the live state or its card gives it" }),
      }),
      async execute(_, { task }): Promise<Result> {
        return readBrowser(cfg, browsers, task);
      },
    }),
  ];
}
