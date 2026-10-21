/**
 * The agent port on Pi (@earendil-works/pi-coding-agent). The conversation
 * lives in remuse's events, not in Pi: each turn is a fresh Pi session given
 * the conversation as the core renders it (context.ts), so a restart loses
 * nothing and the context never outgrows the model. Its reply is what it
 * says once it is done (no more tools); what it writes on the way is not shown
 * (the status line says what it is doing). Pi's coding tools, extensions,
 * skills and context files are all off: the model sees only remuse's tools (tools.ts).
 */
import { type AgentIO, type Ports, type Rules, type Turn, type Workspace, localTime, newId } from "@remuse/core";
import { images, workspaceTools } from "./attachments.ts";
import { redact } from "./redact.ts";
import { type PiModelConfig, type PiSession, openSession, secretsOf } from "./session.ts";
import { statusOf } from "./status.ts";
import { relayTools } from "./runs.ts";
import { taskTools } from "./tasks.ts";
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
  /** Muse's workspace: the files it and the user share. */
  files?: Workspace;
}

const toolLabels: Record<string, string> = {
  browse: "Starting a browser task",
  request_connection: "Preparing a connection",
  app_tools: "Looking up your apps",
  app_call: "Using your apps",
  list_files: "Looking through files",
  read_file: "Looking at a file",
  write_file: "Writing a file",
  move_file: "Moving a file",
  delete_file: "Deleting a file",
  send_file: "Sending you a file",
  schedule: "Scheduling",
  start_task: "Handing off a task",
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
    /** what the model is writing in its current message */
    let said = "";
    try {
      // the user's language, said where the model weighs it most: the system prompt of this turn
      const language = scriptOf(agent.lastWords());
      const system = language ? `${cfg.system}\nThe user writes in ${language}: reply in ${language}.` : cfg.system;
      const session = await openSession(cfg, system, [
        ...tools(io, cfg.rules, cfg.files),
        ...chatTools(io),
        ...scheduleTools(io),
        ...taskTools(io),
        ...relayTools(io),
        ...webTools(io, cfg.rules, cfg.search),
        ...(cfg.apps ? appTools(io, cfg.apps) : []),
        ...(cfg.files ? workspaceTools(io, cfg.files) : []),
      ]);
      lane.session = session;
      const pi = session.session;
      if (!live()) return;
      let failure: string | undefined;
      const unsubscribe = pi.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          said += event.assistantMessageEvent.delta;
        } else if (event.type === "tool_execution_start") {
          // the line under the avatar says what the agent is doing, Muse-style
          emit({ kind: "activity", activity: { kind: "working", label: statusOf(event.args) ?? toolLabels[event.toolName] ?? "Working" } });
        } else if (event.type === "tool_execution_end") {
          emit({ kind: "activity", activity: { kind: "responding", label: null } });
        } else if (event.type === "message_end" && event.message.role === "assistant") {
          // only what the agent says once it is done is its reply; what it writes on the way to a tool
          // is its own thinking aloud (often in another language), and the status line already says what it does
          const { stopReason } = event.message;
          const text = said.trim();
          said = "";
          if (stopReason === "error") failure = event.message.errorMessage ?? "The model run failed";
          else if (text && stopReason !== "toolUse" && stopReason !== "aborted")
            emit({ kind: "upserted", entity: { kind: "reply", id: newId("r"), at: new Date().toISOString(), text, streaming: false, attachments: [] } });
        }
      });
      try {
        // the images the user just sent are seen with their message
        const shown = turn.kind === "message" && cfg.files ? await images(cfg.files, turn.attachments) : [];
        await pi.prompt(brief(agent, turn), { expandPromptTemplates: false, ...(shown.length > 0 ? { images: shown } : {}) });
      } finally {
        unsubscribe();
      }
      if (failure !== undefined) throw new Error(failure);
    } catch (error) {
      if (!live()) return;
      const detail = redact(error instanceof Error ? error.message : String(error), secretsOf(cfg));
      // not something Muse said: a failure of its own kind, with the turn kept to try again
      emit({
        kind: "upserted",
        entity: {
          kind: "failure",
          id: newId("x"),
          at: new Date().toISOString(),
          reason: /content_filter|content filter|safety/i.test(detail) ? "refused" : "failed",
          detail,
          turn: turn.kind === "message" ? { kind: "message" } : { kind: "note", text: turn.text },
          status: "open",
        },
      });
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

/**
 * The language the user writes in, where its script tells it (a model slips into English
 * after reading English pages, or answering a message full of URLs): Chinese, Japanese,
 * Korean. Null for scripts that do not tell (the model goes by the message).
 */
export function scriptOf(text: string): Language | null {
  const plain = text.replace(/https?:\/\/\S+/g, "");
  if (scripts.Japanese.test(plain)) return "Japanese";
  if (scripts.Korean.test(plain)) return "Korean";
  if (scripts.Chinese.test(plain)) return "Chinese";
  return null;
}

type Language = "Chinese" | "Japanese" | "Korean";
/** Characters only that language's script has (Japanese kana; Korean hangul; Chinese, then, han). */
const scripts: Record<Language, RegExp> = { Japanese: /[\u3040-\u30ff]/, Korean: /[\uac00-\ud7af]/, Chinese: /[\u4e00-\u9fff]/ };

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
