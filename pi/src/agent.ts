/**
 * The agent port on Pi (@earendil-works/pi-coding-agent). One long-lived,
 * in-memory Pi session holds the conversation; each prompt streams into a
 * reply entity. Pi's coding tools, extensions, skills and context files are
 * all off: the model sees only what remuse gives it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import type { Emit, Ports } from "@remuse/core";
import { redact } from "./redact.ts";

export interface PiConfig {
  /** "provider/model-id"; the id may contain slashes (openrouter/z-ai/glm-5.3-flash) */
  model: string;
  /** Pi auth file (credentials per provider). Never read or logged here. */
  authPath: string;
  modelsPath?: string;
  system: string;
}

export function parseModel(spec: string): { provider: string; id: string } | undefined {
  const slash = spec.indexOf("/");
  const provider = spec.slice(0, slash).trim();
  const id = spec.slice(slash + 1).trim();
  return slash > 0 && provider && id ? { provider, id } : undefined;
}

/** A resource loader that discovers nothing, so Pi adds no prompts, skills or AGENTS.md of its own. */
function bare(system: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => system,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

async function open(cfg: PiConfig): Promise<AgentSession> {
  const spec = parseModel(cfg.model);
  if (!spec) throw new Error(`Invalid model "${cfg.model}"; use "provider/model-id".`);
  const runtime = await ModelRuntime.create({ authPath: cfg.authPath, modelsPath: cfg.modelsPath ?? null, refreshOnCreate: false });
  const model = runtime.getModel(spec.provider, spec.id);
  if (!model) throw new Error(`Model "${cfg.model}" is not available.`);
  // Pi wants a working directory; nothing is read from or written to it.
  const cwd = mkdtempSync(join(tmpdir(), "remuse-pi-"));
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime: runtime,
    model,
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } }),
    resourceLoader: bare(cfg.system),
    noTools: "all",
  });
  return session;
}

/** prompt + interrupt on Pi. Prompts run one after another; interrupt aborts the current one. */
export function piAgent(cfg: PiConfig): Pick<Ports, "prompt" | "interrupt"> {
  let session: Promise<AgentSession> | undefined;
  const ready = () => {
    session ??= open(cfg).catch((error: unknown) => {
      session = undefined; // retry on the next prompt
      throw error;
    });
    return session;
  };
  let queue: Promise<void> = Promise.resolve();
  let ids = 0;

  const run = async (text: string, emit: Emit) => {
    emit({ kind: "activity", activity: { kind: "responding", label: null } });
    let reply: { id: string; at: string; text: string } | undefined;
    const finish = () => {
      if (reply) emit({ kind: "upserted", entity: { kind: "reply", ...reply, streaming: false } });
      reply = undefined;
    };
    try {
      const live = await ready();
      let failure: string | undefined;
      const unsubscribe = live.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          if (!delta) return;
          if (!reply) {
            reply = { id: `r-pi${++ids}`, at: new Date().toISOString(), text: delta };
            emit({ kind: "upserted", entity: { kind: "reply", ...reply, streaming: true } });
          } else {
            reply.text += delta;
            emit({ kind: "appended", id: reply.id, text: delta });
          }
        } else if (event.type === "message_end" && event.message.role === "assistant") {
          finish();
          if (event.message.stopReason === "error") failure = event.message.errorMessage ?? "The model run failed";
        }
      });
      try {
        await live.prompt(text, { expandPromptTemplates: false });
      } finally {
        unsubscribe();
      }
      if (failure !== undefined) throw new Error(failure);
    } catch (error) {
      finish();
      const message = redact(error instanceof Error ? error.message : String(error), [cfg.authPath, cfg.modelsPath]);
      emit({ kind: "upserted", entity: { kind: "reply", id: `r-pi${++ids}`, at: new Date().toISOString(), text: `Something went wrong: ${message}`, streaming: false } });
    } finally {
      emit({ kind: "activity", activity: null });
    }
  };

  return {
    prompt: (text, emit) => {
      queue = queue.then(() => run(text, emit));
    },
    interrupt: () => {
      void session?.then((live) => live.abort()).catch(() => {});
    },
  };
}
