/**
 * The chat agent's commands, as jobs. `run_command` waits a few seconds; a command still running then is not
 * stopped: it goes on in the sandbox's daemon as a job of this chat, and the tool answers at once. The agent is
 * told when the job ends, the way it is told a task has (io.report): in the middle of its turn, or by a turn
 * of its own when it is idle. So it never has to sleep, poll or hold a helper to wait for a command. A chat has
 * a few at once, each for a half hour at most; the stop button, a reset of the sandbox or its restart end them,
 * and the agent hears of that too. What is interactive, or should be watched, goes in a terminal (herdr), not here.
 * Helpers and tasks do not have jobs: they wait for their commands (sandbox.ts), and nothing of theirs wakes the chat.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type LiveJob, duration } from "@amuse/core";
import { HANDOFF_SECONDS, JOB_LIFETIME, type JobEnd, type JobState, MAX_JOBS, type SandboxClient } from "@amuse/sandbox";
import { Type } from "typebox";
import { HELPER_LIMITS, MACHINE, attempt, ending, printed, say, where } from "./sandbox.ts";
import { status } from "./status.ts";

/** A job the chat has running. */
interface Entry {
  command: string;
  /** when it started, by the chat's clock */
  since: string;
  /** who asked for it to be stopped, if anyone has */
  stopper: "agent" | "user" | null;
}

/** The chat's jobs: the tools, what the stop button does, and what the agent reads about them each turn. */
export interface JobBook {
  /** What each tool does and says, apart from how it is declared (so it can be tried without a model). */
  actions(io: () => AgentIO): { run(args: { command: string; cwd?: string | undefined; background?: boolean | undefined }, signal?: AbortSignal): Promise<string>; output(id: string): Promise<string>; stop(id: string): Promise<string> };
  tools(io: () => AgentIO): ToolDefinition[];
  /** The user stopped the chat (or deleted it): its jobs end, and the agent reads that with its next turn. */
  stopChat(chat: string): void;
  /** The chat's jobs running now, for the block of what is running (core/live.ts). */
  running(chat: string): LiveJob[];
}

/** A command on one line, short enough to name a job by. */
const shown = (command: string) => {
  const line = command.replace(/\s+/g, " ").replaceAll('"', "'").trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

/** How a job went, in words that follow its name; `null` for one that is lost (the sandbox restarted, or could not be reached). */
function how(end: JobEnd | null, seconds: number): string {
  if (end === null) return "was lost: the sandbox restarted or could not be reached, so how it went is not known";
  const took = duration(seconds);
  switch (end.reason) {
    case "timedOut":
      return `was stopped at its limit of ${duration(JOB_LIFETIME)}, still running`;
    case "stopped":
      return `was stopped after ${took}`;
    case "reset":
      return `was ended by a reset of the sandbox, after ${took}`;
    case "finished":
      if (end.signal !== null) return `was ended by the signal ${end.signal} after ${took}`;
      return end.exitCode === 0 ? `finished (exit code 0) after ${took}` : `failed (exit code ${end.exitCode}) after ${took}`;
  }
}

export function jobBook(sandbox: SandboxClient): JobBook {
  const chats = new Map<string, Map<string, Entry>>();
  const of = (chat: string) => {
    const mine = chats.get(chat) ?? new Map<string, Entry>();
    chats.set(chat, mine);
    return mine;
  };

  /** The job's end, once it comes; null when it is lost. */
  const ended = async (chat: string, id: string): Promise<JobState | null> => {
    for (let tries = 0; tries < 3; tries++) {
      try {
        return await sandbox.waitJob({ chat, id });
      } catch {
        // the sandbox restarted or could not be reached: a job it still has is waited for again; one it does not is lost
        const seen = await sandbox.jobOutput({ chat, id }).catch(() => null);
        if (seen === null) return null;
        if (!seen.running) return seen;
      }
    }
    return null;
  };

  /** Tell the agent how the job went, when it has. */
  const follow = async (agent: AgentIO, id: string, entry: Entry) => {
    const state = await ended(agent.chat, id);
    of(agent.chat).delete(id);
    const name = `job ${id} "${shown(entry.command)}"`;
    if (state?.end?.reason === "stopped" && entry.stopper === "agent") return; // it asked, and was told
    if (state?.end?.reason === "stopped" && entry.stopper === "user") return agent.mention(`[${name} was stopped when the user stopped you]`);
    const words = how(state?.end ?? null, state?.seconds ?? 0);
    agent.report(`[${name} ${words}]${state ? `\n${printed(state.output, state.cut)}` : ""}`);
  };

  /** What each tool does and says, apart from how it is declared (so it can be tried without a model). */
  const actions = (io: () => AgentIO) => ({
    run: async ({ command, cwd, background }: { command: string; cwd?: string | undefined; background?: boolean | undefined }, signal?: AbortSignal): Promise<string> => {
      const agent = io();
      const mine = of(agent.chat);
      if (mine.size >= MAX_JOBS) return `${MAX_JOBS} jobs are running already (${[...mine.keys()].join(", ")}): let one end, or stop one with stop_job, then run this.`;
      return await attempt(async () => {
        const state = await sandbox.start({ chat: agent.chat, command, ...(cwd === undefined ? {} : { cwd }), ...(background ? { background } : {}) }, signal);
        // done within the wait: as a command that was waited for
        if (!state.running) {
          const over = { exitCode: state.end?.exitCode ?? null, signal: state.end?.signal ?? null, timedOut: state.end?.reason === "timedOut" };
          return `${ending(over, state.seconds, HELPER_LIMITS)}\n${printed(state.output, state.cut)}`;
        }
        const entry: Entry = { command, since: agent.time().now, stopper: null };
        mine.set(state.id, entry);
        void follow(agent, state.id, entry);
        const began = background ? "Started in the background" : `Still running after ${HANDOFF_SECONDS} seconds, so it went on in the background`;
        return `${began} as job ${state.id}. You will be told when it ends: do not wait for it, poll it or sleep. Tell the user briefly that it runs, and carry on.\nThe output so far:\n${printed(state.output, state.cut)}`;
      });
    },
    output: (id: string) =>
      attempt(async () => {
        const state = await sandbox.jobOutput({ chat: io().chat, id });
        const head = state.running ? `Job ${id} is still running (${duration(state.seconds)}).` : `Job ${id} ${how(state.end, state.seconds)}.`;
        return `${head}\n${printed(state.output, state.cut)}`;
      }),
    stop: (id: string) =>
      attempt(async () => {
        const chat = io().chat;
        const entry = of(chat).get(id);
        if (entry) entry.stopper = "agent";
        const [state] = await sandbox.stopJobs({ chat, id });
        if (!state) return `Job ${id} could not be stopped.`;
        return `Job ${id} ${how(state.end, state.seconds)}.\n${printed(state.output, state.cut)}`;
      }),
  });

  return {
    actions,
    tools: (io) => {
      const act = actions(io);
      return [
        defineTool({
          name: "run_command",
          label: "Run a command",
          description:
            `Run a shell command (bash) on your own machine, the sandbox. It waits up to ${HANDOFF_SECONDS} seconds for the command: if it ends by then you get its output and exit code. If it is still running it is not stopped: it goes on in the background as a job, you get its id and the output so far at once, and you are told when it ends, even after your turn is over. So a long command needs no care: do not sleep, poll or wait for it, and do not hand it to a task or a terminal just to wait; tell the user it is running and carry on (job_output looks at it, stop_job stops it). \`background\` skips the wait for a command you know is long. A job lives ${duration(JOB_LIFETIME)} at most, and a chat has ${MAX_JOBS} at once. Jobs are for commands that run to an end by themselves.` +
            MACHINE,
          parameters: Type.Object({
            status,
            command: Type.String({ description: "The shell command" }),
            cwd: where,
            background: Type.Optional(Type.Boolean({ description: `Run it as a job at once, without the ${HANDOFF_SECONDS} second wait: for a command you know is long` })),
          }),
          async execute(_, args, signal) {
            return say(await act.run(args, signal));
          },
        }),
        defineTool({
          name: "job_output",
          label: "Look at a job",
          description: "What a background job (from run_command) has printed so far, and whether it still runs. For a look at its progress when you need one, not for polling: you are told when it ends.",
          parameters: Type.Object({ status, id: Type.String({ description: "The job's id, like j3" }) }),
          async execute(_, { id }) {
            return say(await act.output(id));
          },
        }),
        defineTool({
          name: "stop_job",
          label: "Stop a job",
          description: "Stop a background job of this chat, with what it printed before it ended.",
          parameters: Type.Object({ status, id: Type.String({ description: "The job's id, like j3" }) }),
          async execute(_, { id }) {
            return say(await act.stop(id));
          },
        }),
      ];
    },
    stopChat(chat) {
      const mine = of(chat);
      if (mine.size === 0) return;
      for (const entry of mine.values()) entry.stopper ??= "user";
      void sandbox.stopJobs({ chat }).catch(() => {});
    },
    running: (chat) => [...of(chat)].map(([id, entry]) => ({ id, command: shown(entry.command), since: entry.since })),
  };
}
