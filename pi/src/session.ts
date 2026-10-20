/**
 * Opening a Pi session the remuse way: a given model and system prompt, only
 * the tools passed in (no built-ins, MCP, extensions, skills or context
 * files), in memory. The model runtime is created once per process.
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
  type ToolDefinition,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";

export interface PiModelConfig {
  /** "provider/model-id"; the id may contain slashes (openrouter/z-ai/glm-5.3-flash) */
  model: string;
  /** Pi auth file (credentials per provider). Never read or logged here. */
  authPath: string;
  modelsPath?: string;
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

const runtimes = new Map<string, Promise<ModelRuntime>>();

function runtime(cfg: PiModelConfig): Promise<ModelRuntime> {
  const key = `${cfg.authPath}\0${cfg.modelsPath ?? ""}`;
  let made = runtimes.get(key);
  if (!made) {
    made = ModelRuntime.create({ authPath: cfg.authPath, modelsPath: cfg.modelsPath ?? null, refreshOnCreate: false });
    made.catch(() => runtimes.delete(key)); // a failed setup is retried next time
    runtimes.set(key, made);
  }
  return made;
}

export async function openSession(cfg: PiModelConfig, system: string, tools: ToolDefinition[]): Promise<AgentSession> {
  const spec = parseModel(cfg.model);
  if (!spec) throw new Error(`Invalid model "${cfg.model}"; use "provider/model-id".`);
  const models = await runtime(cfg);
  const model = models.getModel(spec.provider, spec.id);
  if (!model) throw new Error(`Model "${cfg.model}" is not available.`);
  // Pi wants a working directory; nothing is read from or written to it.
  const cwd = mkdtempSync(join(tmpdir(), "remuse-pi-"));
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime: models,
    model,
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } }),
    resourceLoader: bare(system),
    noTools: "builtin",
    tools: tools.map((tool) => tool.name),
    customTools: tools,
  });
  return session;
}
