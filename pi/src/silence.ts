/**
 * Staying silent. Some turns have nothing for the user (a note from background
 * work that adds nothing, a connection notice already passed on), and the agent
 * needs a way to say so that is not a message: this tool. A turn that calls it
 * shows no reply, whatever else the model writes in it (agent.ts holds that
 * line); an empty reply never reaches the chat either (the core's `blank`).
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** `silent` is called when the model chooses to say nothing this turn. */
export function silenceTools(silent: () => void): ToolDefinition[] {
  return [
    defineTool({
      name: "no_reply",
      label: "Stay silent",
      description:
        "End this turn without a message to the user. Use it when a note from your background work (a task's end, a scheduled check, a heartbeat, a notice you already passed on) has nothing new for them. Anything you write in this turn is dropped, so do not explain why you are staying silent.",
      parameters: Type.Object({}),
      async execute() {
        silent();
        // nothing more to do in this turn: the model is not called again for it
        return { content: [{ type: "text", text: "Nothing is shown to the user." }], details: null, terminate: true };
      },
    }),
  ];
}
