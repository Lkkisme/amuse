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
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { type Keys, newId } from "@remuse/core";
import type { KeyProvider, LoginNote, LoginPrompt, LoginStep, ModelOption, ModelRole } from "@remuse/protocol";
import { z } from "zod";
import { type KeyFile, fileCredentials, readOnlyCredentials } from "./credentials.ts";
import { redact } from "./redact.ts";
import { type PiModelConfig, parseModel, runtime } from "./session.ts";

/** A key that is not a model provider's: one secret, asked for in a sentence, with where to get it. */
export interface AppKey {
  id: string;
  name: string;
  message: string;
  link: { url: string; label: string };
}

export interface PiKeys extends Keys {
  /** The model chosen for `role`, as "provider/model-id"; null: none yet. */
  model(role: ModelRole): string | null;
  /** An app key (by its id), when set up. */
  appKey(id: string): string | null;
  /** Called after any key is set up or forgotten. */
  onChange(listener: () => void): void;
}

const Choice = z.object({
  chat: z.string().nullable(),
  browser: z.string().nullable(),
});
type Choice = z.infer<typeof Choice>;

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
  let choice: Choice = existsSync(choicePath) ? Choice.parse(JSON.parse(readFileSync(choicePath, "utf8"))) : { chat: null, browser: null };
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
    }));
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
    model: (role) => choice[role],
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
      };
    },

    async login(provider) {
      const app = apps.find((a) => a.id === provider);
      if (app)
        return begin(async (interaction) => {
          interaction.notify({
            type: "info",
            message: `Get a key at ${app.link.label}.`,
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
      flow.pending.resolve(value);
      flow.pending = null;
      return step;
    },

    async cancel(login) {
      logins.get(login)?.abort.abort();
      logins.get(login)?.pending?.reject(new Error("The sign-in was stopped."));
    },

    async logout(provider) {
      await keys.delete(provider);
      await loadAppKeys();
      // a model of a provider without a key can no longer be used
      const keep = (ref: string | null) => (ref !== null && parseModel(ref)?.provider === provider ? null : ref);
      choose({ chat: keep(choice.chat), browser: keep(choice.browser) });
      changed();
    },

    async choose(role, model) {
      const option = (await available()).find((m) => m.id === model);
      if (!option) throw new Error(`${model} is not offered by a provider set up with a key.`);
      if (role === "browser" && !option.images) throw new Error(`${option.name} does not see pictures, which the browser needs.`);
      choose({ ...choice, [role]: model });
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
  const chat = env["REMUSE_PI_MODEL"]?.trim() || null;
  if (!existsSync(choicePath) && chat) {
    const choice: Choice = {
      chat,
      browser: env["REMUSE_PI_BROWSER_MODEL"]?.trim() || chat,
    };
    writeFileSync(choicePath, JSON.stringify(choice, null, 2), { mode: 0o600 });
  }
  return adopted;
}
