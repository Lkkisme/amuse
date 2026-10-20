/**
 * What the agent may do with an app's tools, so it cannot do harm on its own.
 * A tool is a read, a change, or destructive (hard or impossible to undo):
 * from the app's own word on it (Composio's MCP hints) where there is one,
 * else from its name. Reads are allowed by default; changes and destructive
 * tools are asked about each time. The user may set each kind otherwise, per
 * app (allow, ask, deny), as Muse does ("Change GitHub repository content:
 * Ask"); a denied tool the agent does not even see.
 */
import type { Permission, ToolKind } from "@remuse/protocol";

const readVerbs = new Set(["GET", "LIST", "FETCH", "SEARCH", "FIND", "READ", "QUERY", "LOOKUP", "VIEW", "DESCRIBE", "COUNT", "EXPORT", "DOWNLOAD"]);
const writeWords = new Set([
  "SEND", "SENDS", "REPLY", "FORWARD", "POST", "PUBLISH", "SHARE", "INVITE", "SUBMIT",
  "CREATE", "INSERT", "ADD", "APPEND", "UPLOAD", "UPDATE", "UPSERT", "EDIT", "MODIFY", "PATCH", "SET", "REPLACE", "MOVE", "RENAME",
  "BOOK", "PAY", "PURCHASE", "BUY", "ORDER", "APPROVE", "MERGE", "CLOSE", "EXECUTE", "RUN", "TRIGGER",
]);
const destroyWords = new Set(["DELETE", "REMOVE", "TRASH", "ARCHIVE", "CLEAR", "CANCEL", "DESTROY", "PURGE", "REVOKE", "UNSUBSCRIBE"]);

/** By name alone: anything not plainly a read changes something; deleting and the like destroys. */
export function kindByName(slug: string): ToolKind {
  const words = slug.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (words.some((w) => destroyWords.has(w))) return "destructive";
  const reads = words.some((w) => readVerbs.has(w));
  const writes = words.some((w) => writeWords.has(w));
  return writes || !reads ? "write" : "read";
}

/** A tool's kind: its hints when it has any (MCP: destructiveHint, readOnlyHint), else its name. */
export function kindOf(slug: string, tags: readonly string[]): ToolKind {
  if (tags.includes("destructiveHint")) return "destructive";
  if (tags.includes("readOnlyHint")) return "read";
  // hinted but neither: it is not read-only, whatever its name says; a name can still tell of destruction
  if (tags.some((t) => t.endsWith("Hint"))) return kindByName(slug) === "destructive" ? "destructive" : "write";
  return kindByName(slug);
}

export const defaultPermission = (kind: ToolKind): Permission => (kind === "read" ? "allow" : "ask");

export const kinds: readonly ToolKind[] = ["read", "write", "destructive"];

/** What the user chose for an app, by kind; a kind not there has its default. */
export type AppRules = Partial<Record<ToolKind, Permission>>;

/** What the agent may do with a tool of `kind`: what the user chose, else the default. */
export const permissionOf = (kind: ToolKind, rules: AppRules): Permission => rules[kind] ?? defaultPermission(kind);

/** The user's choices, per app (the store is the server's: a file beside the journal). */
export interface Rules {
  of(app: string): Promise<AppRules>;
  /** null: back to the default. */
  set(app: string, kind: ToolKind, permission: Permission | null): Promise<void>;
}

/** The choices as a plain map, set by `set` (shared by the stores). */
export function setRule(all: Readonly<Record<string, AppRules>>, app: string, kind: ToolKind, permission: Permission | null): Record<string, AppRules> {
  const mine: AppRules = { ...all[app] };
  if (permission === null) delete mine[kind];
  else mine[kind] = permission;
  return { ...all, [app]: mine };
}

/** Rules kept in memory (the demo, tests). */
export function memoryRules(): Rules {
  let all: Record<string, AppRules> = {};
  return {
    of: async (app) => ({ ...all[app] }),
    async set(app, kind, permission) {
      all = setRule(all, app, kind, permission);
    },
  };
}
