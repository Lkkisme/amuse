/**
 * The agent port on Pi (@earendil-works/pi-coding-agent). The conversation
 * lives in amuse's events, not in Pi: each turn is a fresh Pi session given
 * the conversation as the core renders it (context.ts), so a restart loses
 * nothing and the context never outgrows the model. Its reply is what it
 * says once it is done (no more tools); what it writes on the way is not shown
 * (the status line says what it is doing). Pi's coding tools, extensions,
 * skills and context files are all off: the model sees only amuse's tools (tools.ts).
 */
import { type AgentIO, type Ports, type Rules, type Turn, type Workspace, nowIn, newId } from "@amuse/core";
import { images, workspaceTools } from "./attachments.ts";
import { memoryBrief, memoryReadTools, memoryWriteTools } from "./memory.ts";
import { aboutTools } from "./about.ts";
import { type Skill, allSkills, catalog, skillTools } from "./skills.ts";
import type { Needs } from "@amuse/protocol";
import type { SandboxClient } from "@amuse/sandbox";
import { redact } from "./redact.ts";
import { type PiModelConfig, type PiSession, openSession, secretsOf } from "./session.ts";
import { statusOf } from "./status.ts";
import { relayTools } from "./runs.ts";
import { taskTools } from "./tasks.ts";
import { scheduleTools } from "./schedules.ts";
import { sandboxTools } from "./sandbox.ts";
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
  /** Its own machine to run commands in (the chat agent and its helpers; not the browser agent); without one, no such tools. */
  sandbox?: SandboxClient;
  /** While apps are not set up: how the user sets them up (null once they are). */
  appsSetup?: () => string | null;
  /** The skills that ship with Amuse (the user's own are read from skills/ in the workspace). */
  /** How this instance is set up right now (models, apps, browsers, sandbox), for `amuse_status`. */
  about?: () => Promise<string>;
  skills?: Skill[];
  /** Schedules every instance starts with (memory upkeep, reflection), each set up once, on the user's clock, when they write. */
  defaults?: Defaults;
}

/** A schedule every instance starts with; after that it is the user's like any other. */
export interface DefaultSchedule {
  /** which default it is, for good (the title may change) */
  key: string;
  title: string;
  instructions: string;
  /** on the user's clock */
  cron: string;
  needs: Needs | null;
}

export interface Defaults {
  schedules: DefaultSchedule[];
  /** the keys of those set up already (each once only: the user may have changed or cancelled it since) */
  setUp(): string[];
  markSetUp(keys: string[]): void;
}

/** Set up, in the main chat, the default schedules not set up yet (one added in a later version too), on the user's clock (known once they write). */
function setUpDefaults(defaults: Defaults | undefined, agent: AgentIO): void {
  if (!defaults || !agent.chats().find((c) => c.id === agent.chat)?.main) return;
  const done = defaults.setUp();
  const due = defaults.schedules.filter((d) => !done.includes(d.key));
  if (due.length === 0) return;
  const { timezone } = agent.time();
  for (const d of due)
    agent.act({ kind: "schedule", title: d.title, instructions: d.instructions, when: { kind: "repeat", cron: d.cron, timezone }, needs: d.needs, preset: true });
  defaults.markSetUp([...done, ...due.map((d) => d.key)]);
}

/** Development: every tool call and what came back, on the server's console (they may hold the user's data: never on in production). */
const debugTools = process.env["AMUSE_DEBUG_TOOLS"] === "1";

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
  run_command: "Running a command",
  start_service: "Starting a service",
  service_logs: "Checking a service",
  stop_service: "Stopping a service",
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
      // the skills there are now (the user may have added one), a line each
      const skills = catalog(await allSkills(cfg.skills ?? [], cfg.files));
      const system = [cfg.system, skills, language ? `The user writes in ${language}: reply in ${language}.` : ""].filter(Boolean).join("\n\n");
      if (turn.kind === "message") setUpDefaults(cfg.defaults, agent);
      const session = await openSession(cfg, system, [
        // with memory, memory_search looks in the chats as recall did, and in memory/ too
        ...tools(io, cfg.rules, { files: cfg.files, appsSetup: cfg.appsSetup }).filter((t) => !(cfg.files && t.name === "recall")),
        ...(cfg.files ? [...memoryReadTools(io, cfg.files), ...memoryWriteTools(io, cfg.files)] : []),
        ...skillTools(cfg.skills ?? [], cfg.files),
        ...(cfg.about ? aboutTools(cfg.about) : []),
        ...chatTools(io),
        ...scheduleTools(io, cfg.files),
        ...taskTools(io),
        ...relayTools(io),
        ...webTools(io, cfg.rules, cfg.search),
        ...(cfg.apps ? appTools(io, cfg.apps) : []),
        ...(cfg.files ? workspaceTools(io, cfg.files) : []),
        ...(cfg.sandbox ? sandboxTools(cfg.sandbox) : []),
      ]);
      lane.session = session;
      const pi = session.session;
      if (!live()) return;
      let failure: string | undefined;
      const unsubscribe = pi.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          said += event.assistantMessageEvent.delta;
        } else if (event.type === "tool_execution_start") {
          if (debugTools) console.log(`[tool] ${event.toolName} ${JSON.stringify(event.args).slice(0, 600)}`);
          // the line under the avatar says what the agent is doing, Muse-style
          emit({ kind: "activity", activity: { kind: "working", label: statusOf(event.args) ?? toolLabels[event.toolName] ?? "Working" } });
        } else if (event.type === "tool_execution_end") {
          if (debugTools) console.log(`[tool] ${event.toolName}${event.isError ? " (error)" : ""}: ${JSON.stringify(event.result).slice(0, 600)}`);
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
        const remembered = cfg.files ? await memoryBrief(cfg.files).catch(() => "") : "";
        await pi.prompt(brief(agent, turn, remembered), { expandPromptTemplates: false, ...(shown.length > 0 ? { images: shown } : {}) });
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
function brief(agent: AgentIO, turn: Turn, remembered: string): string {
  const { now, timezone } = agent.time();
  const here = agent.chats().find((c) => c.id === agent.chat);
  const where = here?.main
    ? "You are in the main chat."
    : `You are in a side chat${here?.title ? ` ("${here.title}")` : ""}: only this chat is shown below. The main chat and other chats are there to look up (list_chats, read_chat, recall with everywhere) when the user refers to them.`;
  const task =
    turn.kind === "message"
      ? "Reply to the user's newest message (the last lines above)."
      : `A note from your background work (not from the user). Tell the user only what they need to hear, in your own words, never that a note came. If nothing needs them (all is well, nothing was waiting), reply with nothing at all: an empty reply is not shown.\n${turn.text}`;
  return `${where}\n\n${remembered ? `${remembered}\n\n---\n` : ""}The conversation so far, oldest first (times are the user's, ${timezone}):\n\n${agent.context()}\n\n---\nNow: ${nowIn(now, timezone)}.\n${task}`;
}
