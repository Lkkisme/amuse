/**
 * Pi credentials from an auth file, read once and kept in memory. Pi's own
 * file store takes a lock next to the file on every read, which fails on a
 * read-only mount (a Docker secret); this one only reads, and refuses writes.
 * The file is parsed against Pi's credential shapes; errors never echo it.
 */
import { readFileSync } from "node:fs";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { z } from "zod";

const AuthFile = z.record(
  z.string(),
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("api_key"), key: z.string().exactOptional(), env: z.record(z.string(), z.string()).exactOptional() }),
    z.looseObject({ type: z.literal("oauth"), refresh: z.string(), access: z.string(), expires: z.number() }),
  ]),
);

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
    list: async () => Object.entries(load()).map(([providerId, credential]) => ({ providerId, type: credential.type })),
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
