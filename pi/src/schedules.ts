/**
 * Work for later. The chat agent sets schedules up (schedule, cancel_schedule);
 * when one's time comes, a background agent runs it apart from the chat:
 * briefed with the schedule's instructions and a copy of the conversation as
 * it stands, it does the work with the same tools and rules as the chat
 * agent, and tells the conversation only what is worth telling (`report`).
 * A briefing down, a report up; no reply to the user of its own.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type Ports, describe, nowIn, wallClock } from "@amuse/core";
import type { RunOutcome, When } from "@amuse/protocol";
import { Type } from "typebox";
import type { PiConfig } from "./agent.ts";
import { briefed, clip, helperRules, helperTools, holding, work } from "./worker.ts";
import { status } from "./status.ts";

type Text = { content: { type: "text"; text: string }[]; details: null };
const text = (value: string): Text => ({ content: [{ type: "text", text: value }], details: null });

/** What the agent asked for, as a When on the user's clock; or why it cannot be one. */
export function whenOf(args: { cron?: string; at?: string; timezone?: string }, userZone: string): { ok: true; when: When } | { ok: false; reason: string } {
  const timezone = args.timezone?.trim() || userZone;
  if (args.cron && args.at) return { ok: false, reason: "give either `cron` or `at`, not both" };
  if (args.cron) return { ok: true, when: { kind: "repeat", cron: args.cron.trim(), timezone } };
  if (args.at) {
    const at = wallClock(args.at, timezone);
    return at ? { ok: true, when: { kind: "once", at } } : { ok: false, reason: `"${args.at}" is not a time like 2026-10-21 08:00 in ${timezone}` };
  }
  return { ok: false, reason: "give `cron` for a repeating schedule or `at` for a one-off" };
}

/** The chat agent's tools for setting schedules up and cancelling them. */
export function scheduleTools(io: () => AgentIO): ToolDefinition[] {
  return [
    defineTool({
      name: "schedule",
      label: "Schedule",
      description:
        "Set up work to run later or regularly, e.g. a briefing every morning at 8, a look at the mail every hour, a reminder tomorrow at 9. " +
        "Each run is a background agent with your tools that gets only `instructions` and the conversation; it tells the user only what is worth telling. " +
        "Times are the user's own (their time zone unless `timezone` says otherwise). Your schedules appear in the conversation; `recall` \"Schedule\" finds older ones.",
      parameters: Type.Object({
        status,
        title: Type.String({ description: "Short name the user will see, in their language, e.g. 'Morning briefing'" }),
        instructions: Type.String({
          description:
            "Everything a run must know, in full: what to do, what is worth telling the user and what is not (e.g. 'report only mail that needs an answer today'), and every limit the user set.",
        }),
        cron: Type.Optional(Type.String({ description: "Repeating: a 5-field cron pattern (minute hour day-of-month month day-of-week), e.g. '0 8 * * *' for every day at 8:00, '0 * * * *' hourly. At most every 15 minutes." })),
        at: Type.Optional(Type.String({ description: "One-off: the user's local date and time, 'YYYY-MM-DD HH:mm'" })),
        timezone: Type.Optional(Type.String({ description: "An IANA time zone, only if the user names one other than their own" })),
      }),
      async execute(_, { title, instructions, cron, at, timezone }) {
        const agent = io();
        const { timezone: zone } = agent.time();
        const when = whenOf({ ...(cron ? { cron } : {}), ...(at ? { at } : {}), ...(timezone ? { timezone } : {}) }, zone);
        if (!when.ok) return text(`Not scheduled: ${when.reason}.`);
        const made = agent.act({ kind: "schedule", title, instructions, when: when.when });
        if (!made.ok) return text(`Not scheduled: ${describe(made.rejection)}.`);
        return text(`Scheduled ${made.id}. Tell the user briefly when it will run (their time zone is ${zone}); the schedule shows in the chat.`);
      },
    }),
    defineTool({
      name: "cancel_schedule",
      label: "Cancel a schedule",
      description: "Cancel one of your schedules for good, by its id (e.g. s-…), when the user no longer wants it.",
      parameters: Type.Object({ status, id: Type.String() }),
      async execute(_, { id }) {
        const done = io().act({ kind: "unschedule", id });
        return text(done.ok ? `Cancelled ${id}.` : `Not cancelled: ${describe(done.rejection)}.`);
      },
    }),
  ];
}

const background = [
  ...helperRules,
  "This run is one scheduled task.",
  "If there is something the user should hear, call `report` once with it: the facts, in the user's language, plain text. If nothing is worth telling (no new mail that matters, nothing changed), do not report: the user is not to be bothered for nothing.",
  "When done, end with one short line, in the user's language, on what you did and found; it is kept as the run's record, not shown in the chat.",
].join("\n");

/** Runs schedules with Pi: a helper each (worker.ts), with `report` to tell the user what is worth telling. */
export function piScheduleRunner(cfg: PiConfig): Pick<Ports, "schedule"> {
  return {
    schedule: (schedule, io) =>
      void (async () => {
        const stop = new AbortController();
        const run = { id: schedule.id, title: schedule.title, noun: "scheduled task", io, stop: stop.signal, abort: () => stop.abort() };
        let reported = false;
        const report = defineTool({
          name: "report",
          label: "Tell the user",
          description: "Tell the user something worth their attention from this task. Once per run, only when it matters.",
          parameters: Type.Object({ message: Type.String({ description: "What the user should hear, in their language, plain text" }) }),
          async execute(_, { message }) {
            if (reported) return text("Already reported this run.");
            reported = true;
            io.report(`[scheduled task "${schedule.title}" (${schedule.id})]\n${message}`);
            return text("Reported. Finish with your one-line record.");
          },
        });
        const { now, timezone } = io.time();
        const worked = await work(
          cfg,
          run,
          background,
          [...helperTools(cfg, run, holding(run)), report],
          briefed(io, nowIn(now, timezone), `Scheduled task "${schedule.title}" (${schedule.id}). Instructions:\n${schedule.instructions}`),
        );
        const end = (outcome: Exclude<RunOutcome, "missed">, summary: string) => io.act({ kind: "scheduleRan", id: schedule.id, outcome, summary: clip(summary) });
        switch (worked.kind) {
          case "stopped":
            return void end("stopped", "Stopped by Amuse");
          case "failed":
            return void end(reported ? "reported" : "failed", worked.reason);
          case "done":
            return void end(reported ? "reported" : "quiet", worked.record || (reported ? "Reported" : "Nothing to report"));
        }
      })(),
  };
}
