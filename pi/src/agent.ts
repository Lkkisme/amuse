/**
 * The agent port on Pi (@earendil-works/pi-coding-agent). The conversation
 * lives in remuse's events, not in Pi: each turn is a fresh Pi session given
 * the conversation as the core renders it (context.ts), so a restart loses
 * nothing and the context never outgrows the model. Each turn streams into a
 * reply entity. Pi's coding tools, extensions, skills and context files are
 * all off: the model sees only remuse's tools (tools.ts).
 */
import { type AgentIO, type Ports, type Rules, type Turn, localTime, newId } from "@remuse/core";
import { redact } from "./redact.ts";
import { type PiModelConfig, type PiSession, openSession, secretsOf } from "./session.ts";
import { statusOf } from "./status.ts";
import { relayTools } from "./runs.ts";
import { scheduleTools } from "./schedules.ts";
import { type Apps, appTools, chatTools, tools } from "./tools.ts";
import { type Search, webTools } from "./web.ts";

export interface PiConfig extends PiModelConfig {
  system: string;
  /** Connected apps the agent may use; without them it can only ask to connect. */
  apps?: Apps;
  /** the user's rules (sites the agent may not browse) */
  rules: Rules;
  /** A web search, where one is configured (web_read works without). */
  search?: Search;
}

const toolLabels: Record<string, string> = {
  browse: "Starting a browser task",
  request_connection: "Preparing a connection",
  app_tools: "Looking up your apps",
  app_call: "Using your apps",
  schedule: "Scheduling",
  cancel_schedule: "Cancelling a schedule",
  message_run: "Telling a background task",
  answer_question: "Passing on your answer",
  stop_run: "Stopping a background task",
};

/** One chat's agent: its runs one after another, the session of the one in progress, and its interrupt count. */
interface Lane {
  queue: Promise<void>;
  session: PiSession | undefined;
  /** Bumped by interrupt: the run in progress says nothing more. Queued prompts and reports still run. */
  epoch: number;
}

/**
 * prompt + interrupt + title on Pi. Each chat's prompts run one after another;
 * chats run side by side; interrupt aborts the chat's current run.
 */
export function piAgent(cfg: PiConfig): Pick<Ports, "prompt" | "interrupt" | "title"> {
  const lanes = new Map<string, Lane>();
  const laneOf = (chat: string): Lane => {
    const lane = lanes.get(chat) ?? { queue: Promise.resolve(), session: undefined, epoch: 0 };
    lanes.set(chat, lane);
    return lane;
  };

  const run = async (turn: Turn, agent: AgentIO, lane: Lane) => {
    const mine = lane.epoch;
    const live = () => mine === lane.epoch;
    const emit: AgentIO["emit"] = (say) => {
      if (live()) agent.emit(say);
    };
    /** tools act through this run's chat */
    const io = () => agent;
    emit({ kind: "activity", activity: { kind: "responding", label: null } });
    let reply: { id: string; at: string; text: string } | undefined;
    /** what came before the reply's first visible character */
    let lead = "";
    const finish = () => {
      if (reply) emit({ kind: "upserted", entity: { kind: "reply", ...reply, text: reply.text.trimEnd(), streaming: false } });
      reply = undefined;
      lead = "";
    };
    try {
      const session = await openSession(cfg, cfg.system, [
        ...tools(io, cfg.rules),
        ...chatTools(io),
        ...scheduleTools(io),
        ...relayTools(io),
        ...webTools(io, cfg.rules, cfg.search),
        ...(cfg.apps ? appTools(io, cfg.apps) : []),
      ]);
      lane.session = session;
      const pi = session.session;
      if (!live()) return;
      let failure: string | undefined;
      const unsubscribe = pi.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          if (!delta) return;
          if (!reply) {
            // a model may write a line break or two before calling a tool: that is not a reply
            lead += delta;
            if (!lead.trim()) return;
            reply = { id: newId("r"), at: new Date().toISOString(), text: lead.trimStart() };
            lead = "";
            emit({ kind: "upserted", entity: { kind: "reply", ...reply, streaming: true } });
          } else {
            reply.text += delta;
            emit({ kind: "appended", id: reply.id, text: delta });
          }
        } else if (event.type === "tool_execution_start") {
          // the line under the avatar says what the agent is doing, Muse-style
          emit({ kind: "activity", activity: { kind: "working", label: statusOf(event.args) ?? toolLabels[event.toolName] ?? "Working" } });
        } else if (event.type === "tool_execution_end") {
          emit({ kind: "activity", activity: { kind: "responding", label: null } });
        } else if (event.type === "message_end" && event.message.role === "assistant") {
          finish();
          if (event.message.stopReason === "error") failure = event.message.errorMessage ?? "The model run failed";
        }
      });
      try {
        await pi.prompt(brief(agent, turn), { expandPromptTemplates: false });
      } finally {
        unsubscribe();
      }
      if (failure !== undefined) throw new Error(failure);
    } catch (error) {
      finish();
      if (!live()) return;
      const message = redact(error instanceof Error ? error.message : String(error), secretsOf(cfg));
      emit({ kind: "upserted", entity: { kind: "reply", id: newId("r"), at: new Date().toISOString(), text: `Something went wrong: ${message}`, streaming: false } });
    } finally {
      lane.session?.close();
      lane.session = undefined;
      emit({ kind: "activity", activity: null });
    }
  };

  return {
    prompt: (turn, agent) => {
      const lane = laneOf(agent.chat);
      lane.queue = lane.queue.then(() => run(turn, agent, lane));
    },
    interrupt: (agent) => {
      const lane = laneOf(agent.chat);
      lane.epoch++;
      void lane.session?.session.abort().catch(() => {});
    },
    title: (text) => title(cfg, text),
  };
}

/** A few words naming a chat after its first message, in that message's language. */
async function title(cfg: PiModelConfig, text: string): Promise<string> {
  const session = await openSession(cfg, "You name chats. Reply with a title of two to five words for a chat that starts with the user's message, in the language of the message. The title only: no quotes, no punctuation at the end.", []);
  try {
    let named = "";
    const unsubscribe = session.session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") named += event.assistantMessageEvent.delta;
    });
    try {
      await session.session.prompt(text.slice(0, 2_000), { expandPromptTemplates: false });
    } finally {
      unsubscribe();
    }
    return named.trim().split("\n")[0] ?? "";
  } finally {
    session.close();
  }
}

/** The turn as the model gets it: the conversation, now on the user's clock, then what to do. */
function brief(agent: AgentIO, turn: Turn): string {
  const { now, timezone } = agent.time();
  const here = agent.chats().find((c) => c.id === agent.chat);
  const where = here?.main
    ? "You are in the main chat."
    : `You are in a side chat${here?.title ? ` ("${here.title}")` : ""}: only this chat is shown below. The main chat and other chats are there to look up (list_chats, read_chat, recall with everywhere) when the user refers to them.`;
  const task =
    turn.kind === "message"
      ? "Reply to the user's newest message (the last lines above)."
      : `A note from your background work (not from the user; tell the user what matters):\n${turn.text}`;
  return `${where}\n\nThe conversation so far, oldest first (times are the user's, ${timezone}):\n\n${agent.context()}\n\n---\nNow: ${localTime(now, timezone)}.\n${task}`;
}
