/**
 * Where Pi's credentials come from. The user's keys, set up in the app, live
 * in a file of their own (owner-only, plain JSON in Pi's credential shapes:
 * the instance is the user's); an auth file can also be read as it is, or
 * keys taken from the environment. Errors never echo a file's contents.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
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
