/**
 * Opening a Pi session the amuse way: a given model and system prompt, only
 * the tools passed in (no built-ins, MCP, skills or context files), in
 * memory; and, where asked, Pi's codemode, with which the model writes a
 * short script that calls those same tools (in a QuickJS VM whose only
 * capability is calling them), so many calls take one turn and only what the
 * script returns reaches its context. The model runtime is created once per
 * credential source; the model is the one chosen when the session opens.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  createAgentSession,
  createCodemodeExtension,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import { type Api, type CredentialStore, type Model, type ModelThinkingLevel, clampThinkingLevel } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@amuse/protocol";
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
  /** how much it thinks, as chosen now (clamped to what the model takes); off when not given */
  thinking?: () => ThinkingLevel;
  /** read once into memory, never logged */
  auth: PiAuth;
  modelsPath?: string;
  /** The requested thinking level, clamped by Pi to the model's capabilities. */
  thinkingLevel?: ModelThinkingLevel;
  /** Let a local server decide its output limit instead of sending SDK token caps. */
  omitOutputLimit?: boolean;
  /** Trusted owner configuration loaded once by the host; shared by every operational session. */
  ownerSystem?: string;
}

/** Preserve the request's sampling and messages while letting the server choose its output limit. */
export function withoutOutputLimit(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
  const { max_tokens: _maxTokens, max_completion_tokens: _maxCompletionTokens, max_output_tokens: _maxOutputTokens, ...request } = payload as Record<string, unknown>;
  return request;
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

/** Owner preferences override default presentation, while each session keeps its actual job and tools. */
function configuredSystem(system: string, ownerSystem: string | undefined): string {
  if (!ownerSystem?.trim()) return system;
  return [
    system,
    "The following owner-provided global instructions override the default assistant persona, language, tone, verbosity and output-format rules above, including plain-text-only rules and user-facing status wording. Keep this operation's assigned role and task boundary. Actual tool names, input schemas, required arguments, permissions and protocol requirements remain authoritative. The owner configuration does not add tools or capabilities: never invent them or claim an action succeeded without evidence.",
    "--- Owner global instructions ---",
    ownerSystem,
    "--- End owner global instructions ---",
  ].join("\n\n");
}

const runtimes = new Map<string, Promise<ModelRuntime>>();
const keyRuntimes = new WeakMap<KeyFile, Map<string, Promise<ModelRuntime>>>();

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
    const configurations = keyRuntimes.get(auth.keys) ?? new Map<string, Promise<ModelRuntime>>();
    keyRuntimes.set(auth.keys, configurations);
    const key = cfg.modelsPath ?? "";
    let made = configurations.get(key);
    if (!made) {
      made = create(auth.keys);
      made.catch(() => configurations.delete(key));
      configurations.set(key, made);
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

/**
 * Codemode's resources: the system prompt as given, and Pi's codemode extension (`on`: the tools stay
 * declared as well, each saying how a script calls it), nothing discovered from disk.
 */
async function withCodemode(system: string, cwd: string): Promise<ResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    systemPrompt: system,
    extensionFactories: [createCodemodeExtension({ mode: "on", models: false })],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  return loader;
}

/**
 * `codemode`: give the model Pi's codemode tool too (the chat agent and its helpers; not the browser agent, whose steps
 * are one at a time on a page). `images`: the model must see pictures (the browser's, which may be the chat's).
 */
export async function openSession(
  cfg: PiModelConfig,
  system: string,
  tools: ToolDefinition[],
  { codemode = false, images = false }: { codemode?: boolean; images?: boolean } = {},
): Promise<PiSession> {
  const chosen = cfg.model();
  if (chosen === null) throw new NoModel("No model is set up yet: add a provider's key and choose a model in Settings.");
  const spec = parseModel(chosen);
  if (!spec) throw new Error(`Invalid model "${chosen}"; use "provider/model-id".`);
  const models = await runtime(cfg);
  const model = models.getModel(spec.provider, spec.id);
  if (!model) throw new Error(`Model "${chosen}" is not available.`);
  if (images && !model.input.includes("image"))
    throw new NoModel(`${model.name} does not see pictures, which the browser needs: choose a browser model in Settings.`);
  return sessionOn(models, model, configuredSystem(system, cfg.ownerSystem), tools, {
    codemode,
    thinkingLevel: clampThinkingLevel(model, cfg.thinking?.() ?? cfg.thinkingLevel ?? "off"),
    omitOutputLimit: cfg.omitOutputLimit ?? false,
  });
}

/** A session with `model` from `models` (openSession's own part, apart so a test can give it a model of its own). */
export async function sessionOn(
  models: ModelRuntime,
  model: Model<Api>,
  system: string,
  tools: ToolDefinition[],
  { codemode = false, thinkingLevel = "off", omitOutputLimit = false }: { codemode?: boolean; thinkingLevel?: ModelThinkingLevel; omitOutputLimit?: boolean } = {},
): Promise<PiSession> {
  // Pi wants a working directory; nothing is read from or written to it.
  const cwd = mkdtempSync(join(tmpdir(), "amuse-pi-"));
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime: models,
    model,
    thinkingLevel,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
    resourceLoader: codemode ? await withCodemode(system, cwd) : bare(system),
    noTools: "builtin",
    tools: [...tools.map((tool) => tool.name), ...(codemode ? ["codemode"] : [])],
    customTools: tools,
  });
  if (omitOutputLimit) {
    const stream = session.agent.streamFunction;
    session.agent.streamFunction = (model, context, options) => stream(model, context, {
      ...options,
      onPayload: async (payload, requestModel) => {
        const transformed = await options?.onPayload?.(payload, requestModel);
        return withoutOutputLimit(transformed === undefined ? payload : transformed);
      },
    });
  }
  return {
    session,
    close: () => rmSync(cwd, { recursive: true, force: true }),
  };
}
