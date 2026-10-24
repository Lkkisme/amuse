/**
 * Where Pi's credentials come from. The user's keys, set up in the app, live
 * in the Vault (`storeCredentials`: one entry for each, with a use for
 * the service that needs it); before the store they lived in a file of their
 * own (owner-only, plain JSON in Pi's credential shapes), which an instance
 * that could not move it to the store goes on with. An auth file can also be
 * read as it is, or keys taken from the environment. Errors never echo a
 * file's contents.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import type { ServerService } from "@amuse/protocol";
import type { ServiceStore, ServiceWrite } from "@amuse/core";
import { z } from "zod";

const AuthFile = z.record(
  z.string(),
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("api_key"),
      key: z.string().exactOptional(),
      env: z.record(z.string(), z.string()).exactOptional(),
    }),
    z.looseObject({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
    }),
  ]),
);

/** Pi credentials from an auth file, read once and kept in memory. Pi's own file store takes a lock next to the file on every read, which fails on a read-only mount (a Docker secret); this one only reads, and refuses writes. */
export function readOnlyCredentials(path: string): CredentialStore {
  let data: Record<string, Credential> | undefined;
  const load = () => {
    if (data) return data;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "invalid JSON";
      throw new Error(`The Pi auth file could not be read (${code})`);
    }
    const parsed = AuthFile.safeParse(raw);
    if (!parsed.success) throw new Error("The Pi auth file does not hold Pi credentials");
    data = parsed.data;
    return data;
  };
  const readOnly = async (): Promise<never> => {
    throw new Error("Pi credentials are read-only here");
  };
  return {
    read: async (provider) => load()[provider],
    list: async () =>
      Object.entries(load()).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    modify: readOnly,
    delete: readOnly,
  };
}

/**
 * No stored credentials: Pi then takes each provider's key from its standard
 * environment variable (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, …).
 */
export const environmentCredentials: CredentialStore = {
  read: async () => undefined,
  list: async () => [],
  modify: async () => {
    throw new Error("Pi credentials come from the environment here");
  },
  delete: async () => {
    throw new Error("Pi credentials come from the environment here");
  },
};

/** The user's keys: a credential store, and every secret in it (for errors to leave out). */
export interface KeyFile extends CredentialStore {
  secrets(): string[];
}

/**
 * The user's keys, kept in `path` (made owner-only on first write). Writes go
 * one at a time and land whole (a temporary file renamed over it). Entries
 * that are not a model provider's (the apps' key) live here too, under their own ids.
 */
export function fileCredentials(path: string): KeyFile {
  let data: Record<string, Credential> = {};
  if (existsSync(path)) {
    const parsed = AuthFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) throw new Error("The keys file does not hold credentials");
    data = parsed.data;
  }
  let queue: Promise<unknown> = Promise.resolve();
  /** run `step` after every write before it */
  const serial = <T>(step: () => Promise<T>): Promise<T> => {
    const next = queue.then(step);
    queue = next.catch(() => {});
    return next;
  };
  const save = (next: Record<string, Credential>) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2), {
      mode: 0o600,
    });
    renameSync(`${path}.tmp`, path);
    data = next;
  };
  return {
    read: async (provider) => data[provider],
    list: async () =>
      Object.entries(data).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    modify: (provider, fn) =>
      serial(async () => {
        const next = await fn(data[provider]);
        if (next !== undefined) save({ ...data, [provider]: next });
        return data[provider];
      }),
    delete: (provider) =>
      serial(async () => {
        const { [provider]: _, ...rest } = data;
        save(rest);
      }),
    secrets: () =>
      Object.values(data).flatMap((credential) =>
        credential.type === "api_key"
          ? [credential.key, ...Object.values(credential.env ?? {})].filter((v) => v !== undefined)
          : [credential.access, credential.refresh],
      ),
  };
}

/** The providers whose key also serves speech to text (voice.ts). */
export const SPEECH_PROVIDERS = ["openai", "groq"];
/** Where the key of the user's own speech server is kept, among the credentials. */
export const LOCAL_VOICE = "local-voice";

/** What a credential id serves in the Vault: a provider's models (and its speech, where it has any), the apps, the user's own speech server. */
export function serves(id: string, apps: readonly string[]): { service: ServerService; target: string }[] {
  if (apps.includes(id)) return [{ service: "apps", target: id }];
  if (id === LOCAL_VOICE) return [{ service: "voice", target: "local" }];
  const speech: { service: ServerService; target: string }[] = SPEECH_PROVIDERS.includes(id) ? [{ service: "voice", target: id }] : [];
  return [{ service: "model", target: id }, ...speech];
}

/** The credential id a service in the store stands for; none for a speech service that shares its provider's credential. */
function idOf(service: string, target: string): string | null {
  if (service === "voice") return target === "local" ? LOCAL_VOICE : null;
  return service === "model" || service === "apps" ? target : null;
}

/** Settings of a provider that are not secret (an account, a region, an endpoint); anything else in a credential's `env` is kept secret. */
const PLAIN_SETTING = /(ACCOUNT_ID|PROJECT|REGION|LOCATION|ENDPOINT|URL|HOST|RESOURCE_NAME)/;
const SECRET_LOOKING = /(KEY|SECRET|TOKEN|PASSWORD)/;
const isPlainSetting = (name: string) => PLAIN_SETTING.test(name) && !SECRET_LOOKING.test(name);

/** A sign-in's extra properties that are not text are kept as JSON, under a name that says so. */
const AS_JSON = ":json";

/** A credential as the store keeps it: the lines of text it is made of, which are secret, and which one the services' uses are for. */
export function written(name: string, id: string, credential: Credential, apps: readonly string[]): ServiceWrite {
  const targets = serves(id, apps);
  if (credential.type === "oauth") {
    const { type: _, refresh, access, expires, ...rest } = credential;
    return {
      name,
      managed: true,
      targets,
      bound: "access",
      secret: [
        { name: "access", text: access },
        { name: "refresh", text: refresh },
      ],
      plain: [
        { name: "expires", text: String(expires) },
        ...Object.entries(rest).flatMap(([key, value]) =>
          value === undefined ? [] : [typeof value === "string" ? { name: key, text: value } : { name: `${key}${AS_JSON}`, text: JSON.stringify(value) }],
        ),
      ],
    };
  }
  const env = Object.entries(credential.env ?? {}).flatMap(([key, value]) => (value === undefined ? [] : [{ name: key, text: value }]));
  const secret = [...(credential.key === undefined ? [] : [{ name: "key", text: credential.key }]), ...env.filter((e) => !isPlainSetting(e.name))];
  // a credential of settings alone still has a secret to keep: they are all kept as secrets then
  const alone = secret.length === 0;
  const kept = alone ? env : secret;
  const first = kept[0];
  if (!first) throw new Error("A credential with no key and no settings has nothing to keep.");
  return {
    name,
    managed: false,
    targets,
    bound: credential.key === undefined ? first.name : "key",
    secret: kept,
    plain: alone ? [] : env.filter((e) => isPlainSetting(e.name)),
  };
}

/** A name a variable has (UPPER_CASE): what a credential's settings are named, as against a field a person named ("token"). */
const VARIABLE = /^[A-Z][A-Z0-9_]*$/;

/**
 * The credential a store entry's lines of text stand for. `bound`: the field the services' uses are for, which is the
 * key, when it is called `key` or is not named like a variable (a settings-only credential, with no key, is bound to
 * one of its settings, which are named so).
 */
export function credentialOf(values: Record<string, string>, managed: boolean, bound: string): Credential | undefined {
  if (managed) {
    const { access, refresh, expires, ...rest } = values;
    if (access === undefined || refresh === undefined || expires === undefined) return undefined;
    const extra = Object.fromEntries(
      Object.entries(rest).map(([key, text]): [string, unknown] => {
        if (!key.endsWith(AS_JSON)) return [key, text];
        try {
          return [key.slice(0, -AS_JSON.length), JSON.parse(text)];
        } catch {
          return [key, text];
        }
      }),
    );
    return { ...extra, type: "oauth", access, refresh, expires: Number(expires) };
  }
  const keyField = bound === "key" || !VARIABLE.test(bound) ? bound : undefined;
  const key = keyField === undefined ? undefined : values[keyField];
  const env = Object.fromEntries(Object.entries(values).filter(([name]) => name !== keyField));
  // a key that should be there and is not (it could not be read) makes no credential: Pi is not handed the rest of it
  if (keyField !== undefined && key === undefined) return undefined;
  // and nothing at all is none
  if (key === undefined && Object.keys(env).length === 0) return undefined;
  return { type: "api_key", ...(key === undefined ? {} : { key }), ...(Object.keys(env).length > 0 ? { env } : {}) };
}

/**
 * Pi's credentials, kept in the Vault: one entry for each provider (or the apps, or the user's speech server),
 * with a use for what it serves, so a service finds its key by what it serves and never by an entry. Both kinds of
 * credential are kept: an API key, and a sign-in's tokens, which are a managed entry (read-only in Settings) that
 * Pi's refresh changes in place. A write is one atomic change and asks no one; a refresh reads without it counting
 * as a use. `names` gives an entry its name when it is made.
 */
export function storeCredentials(store: ServiceStore, { apps = [], names = (id: string) => id }: { apps?: readonly string[]; names?: (id: string) => string } = {}): KeyFile {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(step: () => Promise<T>): Promise<T> => {
    const next = queue.then(step);
    queue = next.catch(() => {});
    return next;
  };
  const read = (id: string, record: boolean): Credential | undefined => {
    const first = serves(id, apps)[0];
    const found = first && store.serviceKey(first.service, first.target, record);
    return found && credentialOf(found.values, found.entry.managed, found.field);
  };
  return {
    read: async (id) => read(id, true),
    list: async () => {
      const ids = new Set(store.serviceTargets().flatMap(({ service, target }) => idOf(service, target) ?? []));
      return [...ids].flatMap((providerId) => {
        const credential = read(providerId, false);
        return credential ? [{ providerId, type: credential.type }] : [];
      });
    },
    modify: (id, fn) =>
      serial(async () => {
        const current = read(id, false);
        const next = await fn(current);
        if (next === undefined) return current;
        await store.putService(written(names(id), id, next, apps));
        return read(id, false);
      }),
    delete: (id) =>
      serial(async () => {
        const first = serves(id, apps)[0];
        if (first) await store.dropService(first.service, first.target);
      }),
    secrets: () => store.serviceSecrets(),
  };
}
