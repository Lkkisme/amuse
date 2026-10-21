/**
 * How this Amuse is set up right now, for the agent to look up (what it is
 * made of is the amuse skill): the models chosen, whether apps and the
 * sandbox are on, the browsers there are. Never a key or a password.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { status } from "./status.ts";

type Text = { content: { type: "text"; text: string }[]; details: null };
const text = (value: string): Text => ({ content: [{ type: "text", text: value }], details: null });

/** The setup as the server tells it, or that it cannot be read (never the error itself: it may name the server's files). */
export const setup = (about: () => Promise<string>): Promise<string> => about().catch(() => "The setup cannot be read just now.");

/** `about`: the instance's setup now, in plain lines (the server knows it; see api/src/main.ts). */
export function aboutTools(about: () => Promise<string>): ToolDefinition[] {
  return [
    defineTool({
      name: "amuse_status",
      label: "Checking how I'm set up",
      description:
        "How this Amuse is set up right now: the models chosen, apps set up and the accounts connected, the browsers, the sandbox, speech to text. With the amuse skill, for when the user asks what you can do or how you are set up.",
      parameters: Type.Object({ status }),
      execute: async () => text(await setup(about)),
    }),
  ];
}
