/**
 * The agent port on Pi (@earendil-works/pi-coding-agent). One long-lived,
 * in-memory Pi session holds the conversation; each prompt streams into a
 * reply entity. Pi's coding tools, extensions, skills and context files are
 * all off: the model sees only remuse's tools (tools.ts).
 */
import { type AgentIO, type Ports, newId } from "@remuse/core";
import { redact } from "./redact.ts";
import { type PiModelConfig, type PiSession, openSession, secretsOf } from "./session.ts";
import { statusOf } from "./status.ts";
import { type Apps, appTools, tools } from "./tools.ts";

export interface PiConfig extends PiModelConfig {
  system: string;
  /** Connected apps the agent may use; without them it can only ask to connect. */
  apps?: Apps;
}

const toolLabels: Record<string, string> = {
  browse: "Starting a browser task",
  request_connection: "Preparing a connection",
  app_tools: "Looking up your apps",
  app_call: "Using your apps",
};

/** prompt + interrupt on Pi. Prompts run one after another; interrupt aborts the current one. */
export function piAgent(cfg: PiConfig): Pick<Ports, "prompt" | "interrupt"> {
  /** One session for the life of the process (its scratch dir goes with it). */
  let session: Promise<PiSession> | undefined;
  /** The run in progress; tools act through it. Runs are sequential, so there is at most one. */
  let current: AgentIO | undefined;
  const io = () => {
    if (!current) throw new Error("no run in progress");
    return current;
  };
  const ready = () => {
    session ??= openSession(cfg, cfg.system, [...tools(io), ...(cfg.apps ? appTools(io, cfg.apps) : [])]).catch((error: unknown) => {
      session = undefined; // retry on the next prompt
      throw error;
    });
    return session;
  };
  let queue: Promise<void> = Promise.resolve();
  /** Bumped by interrupt: the run in progress says nothing more. Queued prompts and reports still run. */
  let epoch = 0;

  const run = async (text: string, agent: AgentIO) => {
    const mine = epoch;
    const live = () => mine === epoch;
    const emit: AgentIO["emit"] = (say) => {
      if (live()) agent.emit(say);
    };
    current = agent;
    emit({ kind: "activity", activity: { kind: "responding", label: null } });
    let reply: { id: string; at: string; text: string } | undefined;
    const finish = () => {
      if (reply) emit({ kind: "upserted", entity: { kind: "reply", ...reply, streaming: false } });
      reply = undefined;
    };
    try {
      const { session: pi } = await ready();
      if (!live()) return;
      let failure: string | undefined;
      const unsubscribe = pi.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          if (!delta) return;
          if (!reply) {
            reply = { id: newId("r"), at: new Date().toISOString(), text: delta };
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
        await pi.prompt(text, { expandPromptTemplates: false });
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
      current = undefined;
      emit({ kind: "activity", activity: null });
    }
  };

  return {
    prompt: (text, agent) => {
      queue = queue.then(() => run(text, agent));
    },
    interrupt: () => {
      epoch++;
      void session?.then(({ session: pi }) => pi.abort()).catch(() => {});
    },
  };
}
