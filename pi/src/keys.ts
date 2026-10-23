/**
 * The user's keys and models, as the app sets them up: every provider Pi can
 * take an API key for (and the apps' own key, Composio), which are set up,
 * the models they offer, and the ones chosen for the chat and the browser.
 *
 * Setting a key up is the provider's own sign-in, run here and relayed to the
 * app a step at a time (its key, sometimes an account id or a region): no
 * form is kept per provider. Where a provider offers it, the user can instead
 * sign in with their account there (Pi's OAuth flows): the app opens the
 * provider's page, and the code comes back pasted (the page the sign-in ends
 * on is this server's, which the user's browser cannot reach) or by the
 * provider's own confirmation of a device code. The tokens are kept with the
 * keys, in the same credential store, and Pi refreshes them there; they never
 * leave the server.
 */
import { randomUUID } from "node:crypto";
import { type AuthEvent, type AuthInteraction, type AuthPrompt, clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { type Keys, Rejected, hintOf, newId } from "@amuse/core";
import { type DeviceCode, type KeyGuide, type KeyProvider, type KeyWay, type LoginNote, type LoginPrompt, type LoginStep, type ModelOption, type ModelRole, ThinkingLevel } from "@amuse/protocol";
import { z } from "zod";
import { type KeyFile, LOCAL_VOICE, readOnlyCredentials } from "./credentials.ts";
import { guides } from "./guides.ts";
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

export const Choice = z.object({
  chat: z.string().nullable(),
  browser: z.string().nullable(),
  /** scheduled work's model; null: the chat's */
  background: z.string().nullable().default(null),
  /** the mic's speech service (a provider, or "local"); null: the first with a key */
  voice: z.string().nullable().default(null),
  /** a speech server the user runs themselves (its key, if any, is kept with the keys as LOCAL_VOICE) */
  localVoice: z.object({ url: z.string(), model: z.string() }).nullable().default(null),
  /** this instance's own id, made on first need: Sign in with ChatGPT registers each installation by one */
  installation: z.uuid().nullable().default(null),
  thinking: z
    .object({ chat: ThinkingLevel, browser: ThinkingLevel, background: ThinkingLevel.default("off") })
    .default({ chat: "off", browser: "off", background: "off" }),
});
export type Choice = z.infer<typeof Choice>;

/** Where the models chosen are kept (the server's database; a test's memory). */
export interface Choices {
  /** What was chosen, or null when nothing has been yet. */
  load(): Choice | null;
  save(choice: Choice): void;
}

/** The choices in memory, from `initial` (tests, the demo). */
export function memoryChoices(initial: Choice | null = null): Choices {
  let kept = initial;
  return { load: () => kept, save: (choice) => void (kept = choice) };
}

/** How long a sign-in may wait for its next answer. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** How long keys.wait holds on before it says the step as it stands (a connection may drop while the user is on the provider's page). */
const WAIT_MS = 20_000;
/** How long a sign-in that is over still tells keys.wait how it ended. */
const ENDED_KEPT_MS = 60_000;
/** What the app introduces itself as to a provider's sign-in. */
const AGENT_NAME = "Amuse";
/**
 * Ways of signing in that the provider says suit a browser on another
 * machine: a code to copy (Anthropic) or a device code (Radius, the legacy
 * Codex). The user's browser never is on this server, so these are chosen
 * for them.
 */
const ELSEWHERE = ["copy_code", "device_code"];

const OVER: LoginStep = { kind: "failed", reason: "This sign-in is over; start it again." };

const hint = (key: string | undefined) => (key ? hintOf(key) : null);

function promptOf(prompt: AuthPrompt): LoginPrompt {
  if (prompt.type === "manual_code")
    // the address of the page the sign-in ends on (it starts like the placeholder Pi gives), or a code the provider's page shows
    return { type: /^https?:\/\//.test(prompt.placeholder ?? "") ? "address" : "code", message: prompt.message, placeholder: prompt.placeholder ?? null, options: [] };
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

/** What the provider says along the way. A sign-in with an account says its steps in the app's own words, so Pi's progress ("Listening for OAuth callback on …") is left out there. */
function noteOf(event: AuthEvent, way: KeyWay): LoginNote | null {
  if (event.type === "info")
    return {
      message: event.message,
      links: (event.links ?? []).map((l) => ({
        url: l.url,
        label: l.label ?? null,
      })),
    };
  if (event.type === "progress" && way === "key") return { message: event.message, links: [] };
  return null;
}

function guideOf(id: string): KeyGuide | null {
  const guide = guides[id];
  return guide ? { home: guide.home, keys: guide.keys, docs: guide.docs ?? null, note: guide.note ?? null } : null;
}

/** The providers Pi can take a key for, by id, with the names the user knows them by ("openai" → "OpenAI"). */
export async function providerNames(): Promise<Map<string, string>> {
  const models = await runtime({ auth: { kind: "environment" } });
  return new Map(models.getProviders().map((p) => [p.id, p.name]));
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
  /** the provider's sign-in page, once it has one */
  page: string | null;
  /** the code to enter on that page, once given */
  device: DeviceCode | null;
  pending: { resolve(value: string): void; reject(error: Error): void } | null;
  /** the step said last, for keys.wait to say again while nothing new comes */
  shown: LoginStep | null;
  /** the next step (the last one, once the sign-in is over) */
  step: Promise<LoginStep>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * `keys` holds the keys; `choices` the models chosen; `apps` the keys that
 * are not a model provider's.
 */
export function piKeys({ keys, choices, apps = [], modelsPath }: { keys: KeyFile; choices: Choices; apps?: AppKey[]; modelsPath?: string }): PiKeys {
  const cfg: Pick<PiModelConfig, "auth" | "modelsPath"> = {
    auth: { kind: "keys", keys },
    ...(modelsPath ? { modelsPath } : {}),
  };
  let choice: Choice = choices.load() ?? { chat: null, browser: null, background: null, voice: null, localVoice: null, installation: null, thinking: { chat: "off", browser: "off", background: "off" } };
  const choose = (next: Choice) => {
    choices.save(next);
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

  /** This instance's id, the same on every call (made and kept on the first). */
  const installation = () => {
    const id = choice.installation ?? randomUUID();
    if (choice.installation === null) choose({ ...choice, installation: id });
    return id;
  };

  /** Providers Pi can take an API key for (some also take a sign-in with the user's account). */
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

  /** The model `role` runs on: its own, or (the browser, scheduled work) the chat's when it has none. */
  const runs = (role: ModelRole): string | null => (role === "chat" ? choice.chat : (choice[role] ?? choice.chat));
  /** The level `role`'s model thinks at: the one chosen, or the nearest it takes (some cannot be off). */
  const inEffect = async (role: ModelRole): Promise<ThinkingLevel> => {
    const ref = runs(role);
    const spec = ref ? parseModel(ref) : undefined;
    const model = spec && (await runtime(cfg)).getModel(spec.provider, spec.id);
    return model ? clampThinkingLevel(model, choice.thinking[role]) : choice.thinking[role];
  };

  /** Run a sign-in to its first step; later steps come with each answer, or with keys.wait. */
  const begin = (run: (interaction: AuthInteraction) => Promise<unknown>, way: KeyWay): Promise<LoginStep> => {
    const id = newId("l");
    let wake: (step: LoginStep) => void = () => {};
    const next = () => new Promise<LoginStep>((resolve) => (wake = resolve));
    const flow: Flow = {
      abort: new AbortController(),
      notes: [],
      page: null,
      device: null,
      pending: null,
      shown: null,
      step: next(),
      timer: setTimeout(() => flow.abort.abort(), LOGIN_TIMEOUT_MS),
    };
    flow.timer.unref?.();
    logins.set(id, flow);
    /** whoever waits now hears `step`; the next one is waited for anew */
    const show = (step: LoginStep) => {
      const now = wake;
      flow.step = next();
      flow.shown = step;
      now(step);
    };
    /** the last step: whoever waits hears it, and so does anyone who asks later */
    const end = (step: LoginStep) => {
      flow.shown = step;
      wake(step);
    };
    // a page to open or a code to enter is said once the provider has nothing more to ask in the same breath
    let due = false;
    const waitSoon = () => {
      due = true;
      setTimeout(() => {
        if (!due || !logins.has(id)) return;
        due = false;
        show({ kind: "wait", login: id, notes: flow.notes.splice(0), page: flow.page, device: flow.device });
      }, 0);
    };
    const interaction: AuthInteraction = {
      signal: flow.abort.signal,
      prompt: (prompt) => {
        if (way === "account" && prompt.type === "select") {
          const elsewhere = prompt.options.find((o) => ELSEWHERE.includes(o.id));
          if (elsewhere) return Promise.resolve(elsewhere.id);
        }
        return new Promise<string>((resolve, reject) => {
          due = false;
          const pending = { resolve, reject };
          flow.pending = pending;
          // the provider may stop asking (its own page reached this server first)
          prompt.signal?.addEventListener(
            "abort",
            () => {
              if (flow.pending !== pending) return;
              flow.pending = null;
              reject(new Error("The sign-in went on without this answer."));
            },
            { once: true },
          );
          show({
            kind: "prompt",
            login: id,
            prompt: promptOf(prompt),
            notes: flow.notes.splice(0),
            page: flow.page,
            device: flow.device,
          });
        });
      },
      notify: (event) => {
        if (event.type === "auth_url") {
          flow.page = event.url;
          return waitSoon();
        }
        if (event.type === "device_code") {
          flow.device = {
            code: event.userCode,
            url: event.verificationUri,
            expires: event.expiresInSeconds ? new Date(Date.now() + event.expiresInSeconds * 1000).toISOString() : null,
          };
          return waitSoon();
        }
        const note = noteOf(event, way);
        if (note) flow.notes.push(note);
      },
    };
    const first = flow.step;
    run(interaction)
      .then(
        () => {
          changed();
          end({ kind: "done" });
        },
        (error: unknown) =>
          end({
            kind: "failed",
            reason: flow.abort.signal.aborted ? "The sign-in was stopped." : redact(error instanceof Error ? error.message : String(error), keys.secrets()),
          }),
      )
      .finally(() => {
        due = false;
        flow.pending = null;
        clearTimeout(flow.timer);
        setTimeout(() => logins.delete(id), ENDED_KEPT_MS).unref?.();
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
          way: stored.has(app.id) ? "key" : null,
          hint: hint(await keyOf(app.id)),
          account: null,
          guide: guideOf(app.id),
        })),
      );
      const modelList: KeyProvider[] = await Promise.all(
        (await providers()).map(async (p): Promise<KeyProvider> => {
          const type = stored.get(p.id)?.type;
          return {
            id: p.id,
            name: p.name,
            use: "models",
            connected: type !== undefined,
            way: type === undefined ? null : type === "oauth" ? "account" : "key",
            hint: hint(await keyOf(p.id)),
            account: p.auth.oauth ? { name: p.auth.oauth.name, subscription: p.auth.oauth.isSubscription === true } : null,
            guide: guideOf(p.id),
          };
        }),
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

    async login(provider, way = "key") {
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
        }, "key");
      const found = (await providers()).find((p) => p.id === provider);
      if (!found)
        return {
          kind: "failed",
          reason: `There is no provider "${provider}" to set up with a key.`,
        };
      if (way === "account" && !found.auth.oauth) return { kind: "failed", reason: `${found.name} offers no sign-in with an account here; use an API key.` };
      const models = await runtime(cfg);
      // Pi keeps what the sign-in gives (a key, or the account's tokens) in `keys`, the one credential store
      return begin((interaction) => models.login(provider, way === "account" ? "oauth" : "api_key", interaction, { getDeviceId: installation, agentName: AGENT_NAME }), way);
    },

    async answer(login, value) {
      const flow = logins.get(login);
      if (!flow?.pending) return OVER;
      const step = flow.step;
      flow.pending.resolve(bare(value));
      flow.pending = null;
      return step;
    },

    async wait(login) {
      const flow = logins.get(login);
      if (!flow) return OVER;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const later = new Promise<LoginStep>((resolve) => {
        timer = setTimeout(() => resolve(flow.shown ?? OVER), WAIT_MS);
        timer.unref?.();
      });
      try {
        return await Promise.race([flow.step, later]);
      } finally {
        clearTimeout(timer);
      }
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
        if (role === "chat") throw new Rejected({ kind: "unsound", reason: "The chat needs a model of its own." });
        return choose({ ...choice, [role]: null });
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
 * Once, when nothing is kept yet (the caller says when): take over what the environment held
 * before keys were set up in the app (each provider's <PROVIDER>_API_KEY, the
 * API keys of a Pi auth file, the apps' keys, the models named), so an
 * instance that ran on them goes on.
 */
export async function adoptEnvironment({
  keys,
  choices,
  apps,
  env,
  authFile,
}: {
  /** where they are kept */
  keys: KeyFile;
  choices: Choices;
  /** the apps' keys found, by id */
  apps: Record<string, string | undefined>;
  env: Record<string, string | undefined>;
  /** a Pi auth file: its API keys (not its subscription sign-ins) */
  authFile?: string;
}): Promise<string[]> {
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
  const chat = env["AMUSE_PI_MODEL"]?.trim() || null;
  if (choices.load() === null && chat) {
    const choice: Choice = {
      chat,
      browser: env["AMUSE_PI_BROWSER_MODEL"]?.trim() || null,
      background: null,
      voice: null,
      localVoice: null,
      installation: null,
      thinking: { chat: "off", browser: "off", background: "off" },
    };
    choices.save(choice);
  }
  return adopted;
}
