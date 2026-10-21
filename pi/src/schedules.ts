/**
 * Work for later. The chat agent sets schedules up (schedule, cancel_schedule);
 * when one's time comes, a background agent runs it apart from the chat:
 * briefed with the schedule's instructions and a copy of the conversation as
 * it stands, it does the work with the same tools and rules as the chat
 * agent, and tells the conversation only what is worth telling (`report`).
 * A briefing down, a report up; no reply to the user of its own.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type Ports, describe, localTime, wallClock } from "@remuse/core";
import type { RunOutcome, Schedule, When } from "@remuse/protocol";
import { Type } from "typebox";
import type { PiConfig } from "./agent.ts";
import { redact } from "./redact.ts";
import { type PiSession, openSession, secretsOf } from "./session.ts";
import { type RunHandle, askTool, inbox } from "./runs.ts";
import { status } from "./status.ts";
import { appTools, tools } from "./tools.ts";
import { untrustedRule } from "./untrusted.ts";
import { webTools } from "./web.ts";
import { workspaceTools } from "./attachments.ts";

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
        title: Type.String({ description: "Short name the user will see, in their language, e.g. '每日早报'" }),
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
  "You run one scheduled task in the background for the user of a personal assistant (Muse). You are not in the chat: nothing you write reaches the user except through `report`.",
  "Do the task with your tools. Reading runs at once; anything that sends, changes or deletes goes to the user for approval and runs once they approve (it may time out if they are away): ask only when the task needs it.",
  "If you need an answer only the user has to do the task, ask with `ask_user` (it waits for them, and may get no answer if they are away). Messages from Muse may arrive while you work: follow them.",
  "If there is something the user should hear, call `report` once with it: the facts, in the user's language, plain text. If nothing is worth telling (no new mail that matters, nothing changed), do not report: the user is not to be bothered for nothing.",
  "When done, end with one short line, in the user's language, on what you did and found; it is kept as the run's record, not shown in the chat.",
  "Never claim something you did not do or see.",
  untrustedRule,
].join("\n");

/** The briefing a run gets: what it is, now on the user's clock, the task, and the conversation as background. */
function briefing(schedule: Schedule, io: AgentIO): string {
  const { now, timezone } = io.time();
  return [
    `Now: ${localTime(now, timezone)} (${timezone}).`,
    `Scheduled task "${schedule.title}" (${schedule.id}). Instructions:\n${schedule.instructions}`,
    `---\nThe conversation with the user so far, for background only (do not answer it):\n\n${io.context()}`,
  ].join("\n\n");
}

/** Runs schedules with Pi: one background session each, the chat agent's tools minus setting up more work, plus `report`. */
export function piScheduleRunner(cfg: PiConfig): Pick<Ports, "schedule"> {
  return {
    schedule: (schedule, io) =>
      void (async () => {
        const stop = new AbortController();
        const run: RunHandle = { id: schedule.id, title: schedule.title, noun: "scheduled task", io, stop: stop.signal };
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
        const own = () => io;
        const toolset = [
          ...tools(own, cfg.rules).filter((t) => t.name !== "request_connection"),
          ...webTools(own, cfg.rules, cfg.search),
          ...(cfg.apps ? appTools(own, cfg.apps) : []),
          ...(cfg.files ? workspaceTools(own, cfg.files, { send: false }) : []),
          askTool(run),
          report,
        ];
        let session: PiSession | null = null;
        // Muse's messages reach the run before its next step; its stop ends the run where it is
        const mail = inbox(run, () => session?.session ?? null, () => {
          stop.abort();
          void session?.session.abort().catch(() => {});
        });
        let record = "";
        const end = (outcome: Exclude<RunOutcome, "missed">, summary: string) => io.act({ kind: "scheduleRan", id: schedule.id, outcome, summary: clip(summary) });
        try {
          session = await openSession(cfg, background, toolset);
          try {
            let current = "";
            let failure: string | undefined;
            const unsubscribe = session.session.subscribe((event) => {
              if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") current += event.assistantMessageEvent.delta;
              else if (event.type === "message_end" && event.message.role === "assistant") {
                if (event.message.stopReason === "error") failure = event.message.errorMessage ?? "The model run failed";
                if (current.trim()) record = current.trim();
                current = "";
              }
            });
            try {
              if (!stop.signal.aborted) await session.session.prompt([briefing(schedule, io), mail.drain()].filter(Boolean).join("\n\n"), { expandPromptTemplates: false });
            } finally {
              unsubscribe();
            }
            if (stop.signal.aborted) return void end("stopped", "Stopped by Muse");
            if (failure !== undefined) throw new Error(failure);
          } finally {
            session.close();
          }
          end(reported ? "reported" : "quiet", record || (reported ? "Reported" : "Nothing to report"));
        } catch (error) {
          if (stop.signal.aborted) return void end("stopped", "Stopped by Muse");
          end(reported ? "reported" : "failed", redact(error instanceof Error ? error.message : String(error), secretsOf(cfg)));
        } finally {
          mail.close();
        }
      })(),
  };
}

const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 299)}…` : s);
