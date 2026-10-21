/**
 * What the agent may do with an app's tools, so it cannot do harm on its own.
 * A tool is a read, a change, or destructive (hard or impossible to undo):
 * from the app's own word on it (Composio's MCP hints) where there is one,
 * else from its name. Reads are allowed by default; changes and destructive
 * tools are asked about each time. The user may set each kind otherwise, per
 * app (allow, ask, deny), as Muse does ("Change GitHub repository content:
 * Ask"); a denied tool the agent does not even see.
 */
import type { Permission, ToolKind } from "@amuse/protocol";

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

/* ---------- sites ---------- */

/** A URL's site: its host, lower-case, without "www."; null for what is not a web address. */
export function siteOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { protocol, hostname } = new URL(url);
  return /^https?:$/.test(protocol) && hostname ? hostname.toLowerCase().replace(/^www\./, "") : null;
}

/**
 * What the agents may do at a URL: the user's rule for its site or the nearest
 * parent ("bank.com" covers "login.bank.com").
 *   allow     visit it, and act there without asking
 *   ask       visit it; ask before any step that commits the user
 *   deny      never go there, and do not ask
 *   unlisted  no rule: not visited until the user allows it (asked each time,
 *             or for good: "always" makes it `ask`)
 */
export type SiteAccess = Permission | "unlisted";

export function siteAccess(rules: Readonly<Record<string, Permission>>, url: string): SiteAccess {
  const site = siteOf(url);
  if (!site) return "deny"; // not a web page: nothing to do there
  const labels = site.split(".");
  for (let i = 0; i < labels.length; i++) {
    const rule = rules[labels.slice(i).join(".")];
    if (rule) return rule;
  }
  return "unlisted";
}

/** The rule an answer to "may I visit?" leaves when meant for good: visiting allowed (acting still asked), or never. */
export const visitRule = (approved: boolean): Permission => (approved ? "ask" : "deny");

/** The user's choices, per app and per site (the store is the server's: a file beside the journal). */
export interface Rules {
  of(app: string): Promise<AppRules>;
  /** null: back to the default. */
  set(app: string, kind: ToolKind, permission: Permission | null): Promise<void>;
  sites(): Promise<Readonly<Record<string, Permission>>>;
  /** null: back to the default (ask). */
  setSite(site: string, permission: Permission | null): Promise<void>;
}

/** Everything the rules hold, as one plain value (what the file store writes). */
export type AllRules = { apps: Record<string, AppRules>; sites: Record<string, Permission> };
export const noRules: AllRules = { apps: {}, sites: {} };

export function setSiteRule(all: Readonly<Record<string, Permission>>, site: string, permission: Permission | null): Record<string, Permission> {
  const next = { ...all };
  if (permission === null) delete next[site];
  else next[site] = permission;
  return next;
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
  let all: AllRules = noRules;
  return {
    of: async (app) => ({ ...all.apps[app] }),
    async set(app, kind, permission) {
      all = { ...all, apps: setRule(all.apps, app, kind, permission) };
    },
    sites: async () => ({ ...all.sites }),
    async setSite(site, permission) {
      all = { ...all, sites: setSiteRule(all.sites, site, permission) };
    },
  };
}
