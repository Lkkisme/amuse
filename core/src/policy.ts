/**
 * What the agent may do with an app's tools, so it cannot do harm on its own.
 * A tool is a read, a change, or destructive (hard or impossible to undo):
 * from the app's own word on it (Composio's MCP hints) where there is one,
 * else from its name. Reads are allowed by default; changes and destructive
 * tools are asked about each time. The user may set each kind otherwise, per
 * app (allow, ask, deny), as Muse does ("Change GitHub repository content:
 * Ask"). Deny is a hard no: the tool is still listed, marked as denied, so the
 * agent can say why, but calling it is refused without a card.
 *
 * The browser's rules are by kind of action (visit, submit, download, upload),
 * with exceptions per site; see below.
 */
import { type BrowserAction, type Permission, Site, type SiteActions, type SiteEntry, type ToolKind } from "@amuse/protocol";

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

/* ---------- the browser, by kind of action, with exceptions per site ---------- */

export const browserActions: readonly BrowserAction[] = ["visit", "submit", "download", "upload"];

/** Where nothing is chosen: ask before visiting and before steps that commit the user, keep downloads, ask before uploading. */
export const defaultBrowser: Readonly<Record<BrowserAction, Permission>> = { visit: "ask", submit: "ask", download: "allow", upload: "ask" };

/** A permission as it holds for an action: a user's file is never uploaded without asking. */
const settled = (action: BrowserAction, permission: Permission): Permission => (action === "upload" && permission === "allow" ? "ask" : permission);

/**
 * A web address's host as people write it: lower-case (and as the URL parser makes it, so punycode for a name in another script, a
 * percent-encoded or full-width dot a plain one), without a trailing dot ("evil.com." is evil.com) and without "www."; null for what
 * is not an http(s) address.
 */
export function hostOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { protocol, hostname } = new URL(url);
  const host = hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  return /^https?:$/.test(protocol) && host ? host : null;
}

/**
 * A URL's site, the name the user's rules are kept under: its host, when it is one a rule can name (what the Site format accepts); null
 * for what is not a web address, and for a host no rule can name (an IPv6 address, a name with an underscore): such a page is still
 * visited under the user's settings for the browser, and has no rules of its own.
 */
export function siteOf(url: string): string | null {
  const host = hostOf(url);
  return host !== null && Site.safeParse(host).success ? host : null;
}

/** The sandbox's name on the network its browsers share with it (compose.yaml): Amuse's own, always open to them. */
export const SANDBOX_SITE = "sandbox";

/** A site and its parents, nearest first ("login.bank.com" → login.bank.com, bank.com). */
/**
 * A host and its parents that a rule can name, nearest first ("login.bank.com" → login.bank.com, bank.com). A host no rule can name
 * itself (a label with an underscore) still has parents that can: their rules hold for it ("a_b.evil.com" is under evil.com).
 */
const lineage = (host: string): string[] => {
  const labels = host.split(".");
  return labels.map((_, i) => labels.slice(i).join(".")).filter((name) => Site.safeParse(name).success);
};

/** What the user chose for the browser: for every kind of action, and exceptions per site. */
export interface BrowserRules {
  actions: Readonly<SiteActions>;
  sites: Readonly<Record<string, SiteEntry>>;
}

/** Where a decision came from, for telling the user (and the agent) which rule it was. */
export type RuleSource = { kind: "never"; site: string } | { kind: "site"; site: string } | { kind: "global" } | { kind: "default" } | { kind: "unreachable" };

/**
 * What the browser (or web_read) may do at a URL, for an action. Amuse's own
 * sandbox is always open (uploading still asked, as everywhere). Otherwise, in order:
 *   1. a site, or a parent of it, set to never be visited: no, for every action;
 *   2. the nearest site (itself, then its parents) that sets this action;
 *   3. the user's setting for the action;
 *   4. the default.
 * Something that is not a web page is no (there is nothing to do there).
 */
export function decideBrowser(rules: BrowserRules, url: string, action: BrowserAction): { permission: Permission; source: RuleSource } {
  if (hostOf(url) === null) return { permission: "deny", source: { kind: "unreachable" } };
  if (hostOf(url) === SANDBOX_SITE) return { permission: settled(action, "allow"), source: { kind: "default" } };
  // a host no rule can name has no rule of its own, but its parents' hold
  const chain = lineage(hostOf(url) ?? "");
  for (const name of chain) {
    const entry = rules.sites[name];
    if (entry && (entry.never || entry.actions.visit === "deny")) return { permission: "deny", source: { kind: "never", site: name } };
  }
  for (const name of chain) {
    const set = rules.sites[name]?.actions[action];
    if (set) return { permission: settled(action, set), source: { kind: "site", site: name } };
  }
  const chosen = rules.actions[action];
  return chosen ? { permission: settled(action, chosen), source: { kind: "global" } } : { permission: defaultBrowser[action], source: { kind: "default" } };
}

/** What the browser may do at a URL, for an action (see decideBrowser). */
export const browserPermission = (rules: BrowserRules, url: string, action: BrowserAction): Permission => decideBrowser(rules, url, action).permission;

/** The rule that said no, in words: "your rule for bank.com: never visit it". */
export function ruleSaid(source: RuleSource, action: BrowserAction): string {
  const what = { visit: "visiting websites", submit: "submitting forms", download: "downloading files", upload: "uploading files" }[action];
  switch (source.kind) {
    case "never":
      return `your rule for ${source.site} (never visit it)`;
    case "site":
      return `your rule for ${source.site} (${what}: Deny)`;
    case "unreachable":
      return "it is not a web page";
    default:
      return `your setting for ${what} (Deny)`;
  }
}

/** Where the user can change the rule that said no. */
export function ruleWhere(source: RuleSource): string {
  return source.kind === "never" || source.kind === "site" ? `Settings › Permissions › ${source.site}` : "Settings › Permissions › Browser";
}

/** The rule an answer to a card leaves when meant for good: that action allowed for the site, or (for a visit) never; else denied for that action. */
export const siteRuleFor = (action: BrowserAction, approved: boolean): { action: BrowserAction | "never"; permission: Permission } =>
  approved ? { action, permission: "allow" } : action === "visit" ? { action: "never", permission: "deny" } : { action, permission: "deny" };

/** A site's exceptions after one action is set (null: back to the site following the browser's rules); denying a visit is never; a site with nothing left has no entry. */
export function withSiteAction(entry: SiteEntry | undefined, action: BrowserAction | "never", permission: Permission | null): SiteEntry | null {
  const actions: SiteActions = { ...entry?.actions };
  let never = entry?.never ?? false;
  if (action === "never") never = permission === "deny";
  else if (action === "visit" && permission === "deny") never = true;
  else if (permission === null) delete actions[action];
  else actions[action] = settled(action, permission);
  // visiting is not otherwise set for a site that is never visited
  if (never) delete actions.visit;
  return never || Object.keys(actions).length > 0 ? { never, actions } : null;
}

/** The user's choices, per app and for the browser (the store is the server's: a file beside the journal). */
export interface Rules {
  of(app: string): Promise<AppRules>;
  /** null: back to the default. */
  set(app: string, kind: ToolKind, permission: Permission | null): Promise<void>;
  /** What the user chose for each kind of browser action (a kind not there has its default). */
  browser(): Promise<Readonly<SiteActions>>;
  /** null: back to the default. */
  setBrowser(action: BrowserAction, permission: Permission | null): Promise<void>;
  /** The exceptions per site. */
  sites(): Promise<Readonly<Record<string, SiteEntry>>>;
  /** A site's exceptions as a whole; null: none. */
  setSite(site: string, entry: SiteEntry | null): Promise<void>;
  /** One action for a site (or "never"), as an answer for good on a card; null: back to following the browser's rules. */
  setSiteAction(site: string, action: BrowserAction | "never", permission: Permission | null): Promise<void>;
}

/** What the browser's rules are now. */
export const browserRulesOf = async (rules: Rules): Promise<BrowserRules> => ({ actions: await rules.browser(), sites: await rules.sites() });

/** Everything the rules hold, as one plain value (what the file store writes). */
export type AllRules = { apps: Record<string, AppRules>; browser: SiteActions; sites: Record<string, SiteEntry> };
export const noRules: AllRules = { apps: {}, browser: {}, sites: {} };

/** A site a rule can be kept for: a name the Site format accepts (anything else would not be read back). Throws, in words, for any other. */
export function checkedSite(site: string): string {
  if (!Site.safeParse(site).success) throw new Error(`"${site}" is not a website name a rule can be kept for.`);
  return site;
}

export function setSiteEntry(all: Readonly<Record<string, SiteEntry>>, site: string, entry: SiteEntry | null): Record<string, SiteEntry> {
  checkedSite(site);
  const next = { ...all };
  if (entry === null || (!entry.never && Object.keys(entry.actions).length === 0)) delete next[site];
  else next[site] = entry;
  return next;
}

/** The rules after one action of a site is set. */
export const setSiteAction = (all: Readonly<Record<string, SiteEntry>>, site: string, action: BrowserAction | "never", permission: Permission | null) =>
  setSiteEntry(all, checkedSite(site), withSiteAction(all[site], action, permission));

export function setBrowserAction(all: Readonly<SiteActions>, action: BrowserAction, permission: Permission | null): SiteActions {
  const next: SiteActions = { ...all };
  if (permission === null) delete next[action];
  else next[action] = settled(action, permission);
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
    browser: async () => ({ ...all.browser }),
    async setBrowser(action, permission) {
      all = { ...all, browser: setBrowserAction(all.browser, action, permission) };
    },
    sites: async () => ({ ...all.sites }),
    async setSite(site, entry) {
      all = { ...all, sites: setSiteEntry(all.sites, site, entry) };
    },
    async setSiteAction(site, action, permission) {
      all = { ...all, sites: setSiteAction(all.sites, site, action, permission) };
    },
  };
}
