/**
 * The line under the agent's name, Muse-style: every tool takes a short
 * `status` the agent writes for the user ("查看最新邮件", "Opening the trip
 * portal"), shown while the tool runs; without one, the tool's default label.
 */
import { Type } from "typebox";

export const status = Type.Optional(
  Type.String({
    description: "A few words for the user about what this step does, in their language (e.g. '查看最新邮件', 'Opening the trip portal'). Shown under your name while it runs.",
  }),
);

/** The status the agent wrote into a tool call's arguments, if any. */
export function statusOf(args: unknown): string | null {
  if (typeof args !== "object" || args === null || !("status" in args)) return null;
  const value = args.status;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null;
}
