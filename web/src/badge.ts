/**
 * The line under Amuse's name changes often while it works. The badge keeps its line a moment when it would
 * only flash the generic "responding" text between two tools.
 */
import type { AgentLine } from "./view.ts";

/** How long a tool's line stays when "responding" would replace it. */
export const HOLD_MS = 300;

export const sameLine = (a: AgentLine | null, b: AgentLine | null): boolean => a?.icon === b?.icon && a?.text === b?.text;

/** Whether `next` waits a moment before it replaces `shown`: a tool's line giving way to the generic responding one (a tool is likely next). */
export const holds = (shown: AgentLine | null, next: AgentLine | null): boolean => shown?.icon === "tool" && next?.icon === "list";
