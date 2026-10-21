/**
 * The user's keys and models, as the app sets them up: every provider Pi can
 * take an API key for (and the apps' own key, Composio), which are set up,
 * the models they offer, and the ones chosen for the chat and the browser.
 *
 * Setting a key up is the provider's own sign-in, run here and relayed to the
 * app a prompt at a time (its key, sometimes an account id or a region): no
 * form is kept per provider. Only API keys: the subscription sign-ins Pi knows
 * go through other apps' client ids, so they are left out.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type AuthEvent, type AuthInteraction, type AuthPrompt, clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { type Keys, Rejected, newId } from "@amuse/core";
import { type KeyProvider, type LoginNote, type LoginPrompt, type LoginStep, type ModelOption, type ModelRole, ThinkingLevel } from "@amuse/protocol";
import { z } from "zod";
import { type KeyFile, fileCredentials, readOnlyCredentials } from "./credentials.ts";
import { redact } from "./redact.ts";
import { type PiModelConfig, parseModel, runtime } from "./session.ts";
import { voiceServices } from "./voice.ts";

/** A key that is not a model provider's: one secret, asked for in a sentence, with where to get it. */
export interface AppKey {
  id: string;
  name: string;
  message: string;
  /** where the user finds the key, said with the link to it */
  where: string;
  link: { url: string; label: string };
  /** One short request with `key`; throws when it does not work. */
  test?(key: string): Promise<void>;
}

/** How long a key's test may take. */
const TEST_TIMEOUT_MS = 30_000;

export interface PiKeys extends Keys {
  /** The model `role` runs on, as "provider/model-id" (scheduled work: the chat's when it has none of its own); null: none yet. */
  model(role: ModelRole): string | null;
  /** How much `role`'s model thinks. */
  thinking(role: ModelRole): ThinkingLevel;
  /** The mic's speech service, as the user chose it (null: the first with a key). */
  voiceChoice(): string | null;
  /** The user's own speech server, when set up. */
  localVoiceService(): { url: string; model: string } | null;
  /** An app key (by its id), when set up. */
  appKey(id: string): string | null;
  /** Called after any key is set up or forgotten. */
  onChange(listener: () => void): void;
}

const Choice = z.object({
  chat: z.string().nullable(),
  browser: z.string().nullable(),
  /** scheduled work's model; null: the chat's */
  background: z.string().nullable().default(null),
  /** the mic's speech service (a provider, or "local"); null: the first with a key */
  voice: z.string().nullable().default(null),
  /** a speech server the user runs themselves (its key, if any, is kept with the keys as LOCAL_VOICE) */
  localVoice: z.object({ url: z.string(), model: z.string() }).nullable().default(null),
  thinking: z
    .object({ chat: ThinkingLevel, browser: ThinkingLevel, background: ThinkingLevel.default("off") })
    .default({ chat: "off", browser: "off", background: "off" }),
});
type Choice = z.infer<typeof Choice>;

/** Where the key of the user's own speech server is kept, among the keys. */
export const LOCAL_VOICE = "local-voice";

/** How long a sign-in may wait for its next answer. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;

const hint = (key: string | undefined) => (key && key.length >= 8 ? `…${key.slice(-4)}` : null);

function promptOf(prompt: AuthPrompt): LoginPrompt | null {
  if (prompt.type !== "text" && prompt.type !== "secret" && prompt.type !== "select") return null;
  return {
    type: prompt.type,
    message: prompt.message,
    placeholder: prompt.type === "select" ? null : (prompt.placeholder ?? null),
    options:
      prompt.type === "select"
        ? prompt.options.map((o) => ({
            id: o.id,
            label: o.label,
            description: o.description ?? null,
          }))
        : [],
  };
}

function noteOf(event: AuthEvent): LoginNote | null {
  if (event.type === "info")
    return {
      message: event.message,
      links: (event.links ?? []).map((l) => ({
        url: l.url,
        label: l.label ?? null,
      })),
    };
  if (event.type === "progress") return { message: event.message, links: [] };
  return null; // auth_url and device_code belong to OAuth, which is not offered
}

/** A provider's error as a person reads it: "401 {…"message":"The API key you provided is invalid."…}" → "401 · The API key you provided is invalid." */
export function plainly(error: string): string {
  const json = error.indexOf("{");
  if (json < 0) return error;
  let body: unknown;
  try {
    body = JSON.parse(error.slice(json));
  } catch {
    return error;
  }
  const message = (value: unknown): string | null => {
    if (typeof value !== "object" || value === null) return null;
    if ("message" in value && typeof value.message === "string") return value.message;
    return "error" in value ? (typeof value.error === "string" ? value.error : message(value.error)) : null;
  };
  const said = message(body);
  const before = error.slice(0, json).trim().replace(/[:\s]+$/, "");
  return said ? (before ? `${before} · ${said}` : said) : error;
}

/**
 * A value as pasted, without what it was copied with: a line from an env
 * file (`COMPOSIO_API_KEY=ak_…`, `export X="…"`) gives its value; spaces
 * around it go.
 */
export function bare(value: string): string {
  // an env variable's name is upper case; a key's own "=" (base64's padding) is not one
  const line = value.trim().match(/^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(\S.*)$/s);
  const given = (line?.[1] ?? value).trim();
  const quoted = given.match(/^(["'])(.*)\1$/s);
  return (quoted?.[2] ?? given).trim();
}

/** A sign-in in progress: what it waits for, and how to hear its next step. */
interface Flow {
  abort: AbortController;
  notes: LoginNote[];
  pending: { resolve(value: string): void; reject(error: Error): void } | null;
  step: Promise<LoginStep>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * `keys` holds the keys; `choicePath` the models chosen; `apps` the keys that
 * are not a model provider's.
 */
export function piKeys({ keys, choicePath, apps = [], modelsPath }: { keys: KeyFile; choicePath: string; apps?: AppKey[]; modelsPath?: string }): PiKeys {
  const cfg: Pick<PiModelConfig, "auth" | "modelsPath"> = {
    auth: { kind: "keys", keys },
    ...(modelsPath ? { modelsPath } : {}),
  };
  let choice: Choice = existsSync(choicePath) ? Choice.parse(JSON.parse(readFileSync(choicePath, "utf8"))) : { chat: null, browser: null, background: null, voice: null, localVoice: null, thinking: { chat: "off", browser: "off", background: "off" } };
  const choose = (next: Choice) => {
    writeFileSync(`${choicePath}.tmp`, JSON.stringify(next, null, 2), {
      mode: 0o600,
    });
    renameSync(`${choicePath}.tmp`, choicePath);
    choice = next;
  };
  const listeners: (() => void)[] = [];
  const changed = () => listeners.forEach((listener) => listener());
  const logins = new Map<string, Flow>();
  const appKeys = new Map<string, string>();
  const loadAppKeys = async () => {
    for (const app of apps) {
      const credential = await keys.read(app.id);
      if (credential?.type === "api_key" && credential.key) appKeys.set(app.id, credential.key);
      else appKeys.delete(app.id);
    }
  };
  const loaded = loadAppKeys();

  /** Providers Pi can take an API key for. */
  const providers = async () => (await runtime(cfg)).getProviders().filter((p) => p.auth.apiKey?.login !== undefined);

  /** The models of the providers set up here (not ones whose key happens to be in the environment). */
  const available = async (): Promise<ModelOption[]> => {
    const set = new Set((await keys.list()).map((c) => c.providerId));
    const models = (await (await runtime(cfg)).getAvailable()).filter((m) => set.has(m.provider));
    return models.map((m) => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      images: m.input.includes("image"),
      thinking: getSupportedThinkingLevels(m),
    }));
  };

  /** The model `role` runs on: its own, or (scheduled work) the chat's when it has none. */
  const runs = (role: ModelRole): string | null => (role === "background" ? (choice.background ?? choice.chat) : choice[role]);
  /** The level `role`'s model thinks at: the one chosen, or the nearest it takes (some cannot be off). */
  const inEffect = async (role: ModelRole): Promise<ThinkingLevel> => {
    const ref = runs(role);
    const spec = ref ? parseModel(ref) : undefined;
    const model = spec && (await runtime(cfg)).getModel(spec.provider, spec.id);
    return model ? clampThinkingLevel(model, choice.thinking[role]) : choice.thinking[role];
  };

  /** Run a sign-in to its first step; later steps come with each answer. */
  const begin = (run: (interaction: AuthInteraction) => Promise<unknown>): Promise<LoginStep> => {
    const id = newId("l");
    let wake: (step: LoginStep) => void = () => {};
    const next = () => new Promise<LoginStep>((resolve) => (wake = resolve));
    const flow: Flow = {
      abort: new AbortController(),
      notes: [],
      pending: null,
      step: next(),
      timer: setTimeout(() => flow.abort.abort(), LOGIN_TIMEOUT_MS),
    };
    flow.timer.unref?.();
    logins.set(id, flow);
    const interaction: AuthInteraction = {
      signal: flow.abort.signal,
      prompt: (prompt) =>
        new Promise<string>((resolve, reject) => {
          const shown = promptOf(prompt);
          if (!shown) return reject(new Error("This provider asks for a kind of sign-in the app does not offer."));
          flow.pending = { resolve, reject };
          // whoever waits now hears this prompt; the next step is waited for anew
          const now = wake;
          flow.step = next();
          now({
            kind: "prompt",
            login: id,
            prompt: shown,
            notes: flow.notes.splice(0),
          });
        }),
      notify: (event) => {
        const note = noteOf(event);
        if (note) flow.notes.push(note);
      },
    };
    const first = flow.step;
    run(interaction)
      .then(
        () => {
          changed();
          wake({ kind: "done" });
        },
        (error: unknown) =>
          wake({
            kind: "failed",
            reason: flow.abort.signal.aborted ? "The sign-in was stopped." : redact(error instanceof Error ? error.message : String(error), keys.secrets()),
          }),
      )
      .finally(() => {
        clearTimeout(flow.timer);
        logins.delete(id);
      });
    return first;
  };

  return {
    model: (role) => runs(role),
    thinking: (role) => choice.thinking[role],
    voiceChoice: () => choice.voice,
    localVoiceService: () => choice.localVoice,
    appKey: (id) => appKeys.get(id) ?? null,
    onChange: (listener) => void listeners.push(listener),

    async list() {
      await loaded;
      const stored = new Map((await keys.list()).map((c) => [c.providerId, c]));
      const keyOf = async (id: string) => {
        const credential = await keys.read(id);
        return credential?.type === "api_key" ? credential.key : undefined;
      };
      const appList: KeyProvider[] = await Promise.all(
        apps.map(async (app): Promise<KeyProvider> => ({
          id: app.id,
          name: app.name,
          use: "apps",
          connected: stored.has(app.id),
          hint: hint(await keyOf(app.id)),
        })),
      );
      const modelList: KeyProvider[] = await Promise.all(
        (await providers()).map(async (p): Promise<KeyProvider> => ({
          id: p.id,
          name: p.name,
          use: "models",
          connected: stored.has(p.id),
          hint: hint(await keyOf(p.id)),
        })),
      );
      modelList.sort((a, b) => a.name.localeCompare(b.name));
      return {
        providers: [...appList, ...modelList],
        models: await available(),
        chat: choice.chat,
        browser: choice.browser,
        background: choice.background,
        thinking: { chat: await inEffect("chat"), browser: await inEffect("browser"), background: await inEffect("background") },
        voice: {
          services: [
            ...voiceServices.filter((v) => stored.has(v.provider)).map(({ provider, name }) => ({ provider, name })),
            ...(choice.localVoice ? [{ provider: "local", name: `Your own server (${choice.localVoice.model})` }] : []),
          ],
          chosen: choice.voice,
          local: choice.localVoice,
        },
      };
    },

    async login(provider) {
      const app = apps.find((a) => a.id === provider);
      if (app)
        return begin(async (interaction) => {
          interaction.notify({
            type: "info",
            message: app.where,
            links: [{ url: app.link.url, label: app.link.label }],
          });
          const key = (await interaction.prompt({ type: "secret", message: app.message })).trim();
          if (!key) throw new Error("No key was given.");
          await keys.modify(app.id, async () => ({ type: "api_key", key }));
          await loadAppKeys();
        });
      if (!(await providers()).some((p) => p.id === provider))
        return {
          kind: "failed",
          reason: `There is no provider "${provider}" to set up with a key.`,
        };
      const models = await runtime(cfg);
      return begin((interaction) => models.login(provider, "api_key", interaction));
    },

    async answer(login, value) {
      const flow = logins.get(login);
      if (!flow?.pending)
        return {
          kind: "failed",
          reason: "This sign-in is over; start it again.",
        };
      const step = flow.step;
      flow.pending.resolve(bare(value));
      flow.pending = null;
      return step;
    },

    async cancel(login) {
      logins.get(login)?.abort.abort();
      logins.get(login)?.pending?.reject(new Error("The sign-in was stopped."));
    },

    async test(provider) {
      const why = (e: unknown) => redact(plainly(e instanceof Error ? e.message : String(e)), keys.secrets());
      const app = apps.find((a) => a.id === provider);
      if (app) {
        await loaded;
        const key = appKeys.get(app.id);
        if (!key) return { ok: false, detail: "No key is set up." };
        try {
          await app.test?.(key);
          return { ok: true, detail: "The key works." };
        } catch (e) {
          return { ok: false, detail: why(e) };
        }
      }
      if (!(await keys.read(provider))) return { ok: false, detail: "No key is set up." };
      const models = await runtime(cfg);
      // the model chosen from this provider, else the first it offers
      const chosen = [choice.chat, choice.browser].map((ref) => (ref ? parseModel(ref) : undefined)).find((spec) => spec?.provider === provider);
      const model = (chosen && models.getModel(chosen.provider, chosen.id)) ?? (await models.getAvailable(provider))[0];
      if (!model) return { ok: false, detail: "This provider offers no model to try." };
      try {
        const reply = await models.completeSimple(
          model,
          { messages: [{ role: "user", content: "Reply with the word OK.", timestamp: Date.now() }] },
          { maxTokens: 32, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) },
        );
        if (reply.stopReason === "error" || reply.stopReason === "aborted")
          return { ok: false, detail: why(reply.errorMessage ?? "The provider did not answer.") };
        return { ok: true, detail: `${model.name} answered.` };
      } catch (e) {
        return { ok: false, detail: why(e) };
      }
    },

    async logout(provider) {
      await keys.delete(provider);
      await loadAppKeys();
      // a model of a provider without a key can no longer be used
      const keep = (ref: string | null) => (ref !== null && parseModel(ref)?.provider === provider ? null : ref);
      choose({ ...choice, chat: keep(choice.chat), browser: keep(choice.browser), background: keep(choice.background) });
      changed();
    },

    async choose(role, model) {
      if (model === null) {
        if (role !== "background") throw new Rejected({ kind: "unsound", reason: `The ${role} needs a model of its own.` });
        return choose({ ...choice, background: null });
      }
      const option = (await available()).find((m) => m.id === model);
      if (!option) throw new Rejected({ kind: "unsound", reason: `${model} is not offered by a provider set up with a key.` });
      if (role === "browser" && !option.images) throw new Rejected({ kind: "unsound", reason: `${option.name} does not see pictures, which the browser needs.` });
      // the thinking level goes as near as the new model takes
      const spec = parseModel(model);
      const picked = spec && (await runtime(cfg)).getModel(spec.provider, spec.id);
      const level = picked ? clampThinkingLevel(picked, choice.thinking[role]) : "off";
      choose({ ...choice, [role]: model, thinking: { ...choice.thinking, [role]: level } });
    },

    async voice(provider) {
      if (provider === "local") {
        if (!choice.localVoice) throw new Rejected({ kind: "unsound", reason: "Set up your own speech server first." });
        return choose({ ...choice, voice: "local" });
      }
      if (provider !== null && !voiceServices.some((v) => v.provider === provider))
        throw new Rejected({ kind: "unsound", reason: `${provider} does not turn speech into text here.` });
      if (provider !== null && !(await keys.read(provider))) throw new Rejected({ kind: "unsound", reason: `Add a key for ${provider} first.` });
      choose({ ...choice, voice: provider });
    },

    async localVoice(service) {
      if (service === null) {
        await keys.delete(LOCAL_VOICE);
        return choose({ ...choice, localVoice: null, voice: choice.voice === "local" ? null : choice.voice });
      }
      if (!/^https?:\/\//.test(service.url)) throw new Rejected({ kind: "unsound", reason: "The server's address starts with http:// or https://." });
      const key = service.key?.trim();
      if (key) await keys.modify(LOCAL_VOICE, async () => ({ type: "api_key", key: bare(key) }));
      else await keys.delete(LOCAL_VOICE);
      choose({ ...choice, localVoice: { url: service.url.trim(), model: service.model.trim() } });
    },

    async think(role, level) {
      const chosen = runs(role);
      if (chosen === null) throw new Rejected({ kind: "unsound", reason: "Choose a model first." });
      const option = (await available()).find((m) => m.id === chosen);
      if (!option?.thinking.includes(level)) throw new Rejected({ kind: "unsound", reason: `${option?.name ?? chosen} does not take the thinking level ${level}.` });
      choose({ ...choice, thinking: { ...choice.thinking, [role]: level } });
    },
  };
}

/**
 * Once, when there is no keys file yet: take over what the environment held
 * before keys were set up in the app (each provider's <PROVIDER>_API_KEY, the
 * API keys of a Pi auth file, the apps' keys, the models named), so an
 * instance that ran on them goes on.
 */
export async function adoptEnvironment({
  keysPath,
  choicePath,
  apps,
  env,
  authFile,
}: {
  keysPath: string;
  choicePath: string;
  /** the apps' keys found, by id */
  apps: Record<string, string | undefined>;
  env: Record<string, string | undefined>;
  /** a Pi auth file: its API keys (not its subscription sign-ins) */
  authFile?: string;
}): Promise<string[]> {
  if (existsSync(keysPath)) return [];
  const keys = fileCredentials(keysPath);
  const adopted: string[] = [];
  const models = await runtime({ auth: { kind: "keys", keys } });
  for (const provider of models.getProviders()) {
    if (provider.auth.apiKey?.login === undefined) continue;
    const key = env[`${provider.id.toUpperCase().replaceAll("-", "_")}_API_KEY`]?.trim();
    if (!key) continue;
    await keys.modify(provider.id, async () => ({ type: "api_key", key }));
    adopted.push(provider.id);
  }
  if (authFile) {
    const file = readOnlyCredentials(authFile);
    for (const { providerId, type } of await file.list()) {
      const credential = await file.read(providerId);
      if (type !== "api_key" || credential?.type !== "api_key" || adopted.includes(providerId)) continue;
      await keys.modify(providerId, async () => credential);
      adopted.push(providerId);
    }
  }
  for (const [id, key] of Object.entries(apps)) {
    if (!key) continue;
    await keys.modify(id, async () => ({ type: "api_key", key }));
    adopted.push(id);
  }
  // an empty file says the environment was looked at
  if (adopted.length === 0) await keys.delete("none");
  const chat = env["AMUSE_PI_MODEL"]?.trim() || null;
  if (!existsSync(choicePath) && chat) {
    const choice: Choice = {
      chat,
      browser: env["AMUSE_PI_BROWSER_MODEL"]?.trim() || chat,
      background: null,
      voice: null,
      localVoice: null,
      thinking: { chat: "off", browser: "off", background: "off" },
    };
    writeFileSync(choicePath, JSON.stringify(choice, null, 2), { mode: 0o600 });
  }
  return adopted;
}
