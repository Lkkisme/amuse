/**
 * Opening a Pi session the amuse way: a given model and system prompt, only
 * the tools passed in (no built-ins, MCP, extensions, skills or context
 * files), in memory. The model runtime is created once per credential source;
 * the model is the one chosen when the session opens.
 */
import { mkdtempSync, rmSync } from "node:fs";
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
import type { CredentialStore } from "@earendil-works/pi-ai";
import { type KeyFile, environmentCredentials, readOnlyCredentials } from "./credentials.ts";

/**
 * Where the model's credentials come from: the user's keys (set up in the app),
 * a Pi auth file (per provider), or the environment, where Pi reads each
 * provider's standard variable.
 */
export type PiAuth = { kind: "keys"; keys: KeyFile } | { kind: "file"; path: string } | { kind: "environment" };

/** No model is chosen (or its provider has no key): said to the user as it is. */
export class NoModel extends Error {}

export interface PiModelConfig {
  /** "provider/model-id" as chosen now (the id may contain slashes: openrouter/z-ai/glm-5.3-flash); null: none yet */
  model: () => string | null;
  /** read once into memory, never logged */
  auth: PiAuth;
  modelsPath?: string;
}

/** API keys in the environment, by their standard names (…_API_KEY). */
const environmentKeys = () => Object.entries(process.env).flatMap(([name, value]) => (name.endsWith("_API_KEY") && value ? [value] : []));

/** What error messages must never show: the credentials, and where they live. */
export const secretsOf = (cfg: PiModelConfig): (string | undefined)[] => [
  ...(cfg.auth.kind === "file" ? [cfg.auth.path] : []),
  ...(cfg.auth.kind === "keys" ? cfg.auth.keys.secrets() : []),
  ...environmentKeys(),
  cfg.modelsPath,
];

export function parseModel(spec: string): { provider: string; id: string } | undefined {
  const slash = spec.indexOf("/");
  const provider = spec.slice(0, slash).trim();
  const id = spec.slice(slash + 1).trim();
  return slash > 0 && provider && id ? { provider, id } : undefined;
}

/** A resource loader that discovers nothing, so Pi adds no prompts, skills or AGENTS.md of its own. */
function bare(system: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
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
const keyRuntimes = new WeakMap<KeyFile, Promise<ModelRuntime>>();

/** The model runtime for `cfg`'s credentials (made once; a failed setup is retried next time). */
export function runtime(cfg: Pick<PiModelConfig, "auth" | "modelsPath">): Promise<ModelRuntime> {
  const { auth } = cfg;
  const create = (credentials: CredentialStore) =>
    ModelRuntime.create({
      credentials,
      modelsPath: cfg.modelsPath ?? null,
      refreshOnCreate: false,
    });
  if (auth.kind === "keys") {
    let made = keyRuntimes.get(auth.keys);
    if (!made) {
      made = create(auth.keys);
      made.catch(() => keyRuntimes.delete(auth.keys));
      keyRuntimes.set(auth.keys, made);
    }
    return made;
  }
  const key = `${auth.kind === "file" ? `file:${auth.path}` : "environment"}\0${cfg.modelsPath ?? ""}`;
  let made = runtimes.get(key);
  if (!made) {
    made = create(auth.kind === "file" ? readOnlyCredentials(auth.path) : environmentCredentials);
    made.catch(() => runtimes.delete(key));
    runtimes.set(key, made);
  }
  return made;
}

/** A Pi session and how to let go of it (its scratch directory is removed). */
export interface PiSession {
  session: AgentSession;
  close(): void;
}

export async function openSession(cfg: PiModelConfig, system: string, tools: ToolDefinition[]): Promise<PiSession> {
  const chosen = cfg.model();
  if (chosen === null) throw new NoModel("No model is set up yet: add a provider's key and choose a model in Settings.");
  const spec = parseModel(chosen);
  if (!spec) throw new Error(`Invalid model "${chosen}"; use "provider/model-id".`);
  const models = await runtime(cfg);
  const model = models.getModel(spec.provider, spec.id);
  if (!model) throw new Error(`Model "${chosen}" is not available.`);
  // Pi wants a working directory; nothing is read from or written to it.
  const cwd = mkdtempSync(join(tmpdir(), "amuse-pi-"));
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime: models,
    model,
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
    resourceLoader: bare(system),
    noTools: "builtin",
    tools: tools.map((tool) => tool.name),
    customTools: tools,
  });
  return {
    session,
    close: () => rmSync(cwd, { recursive: true, force: true }),
  };
}
