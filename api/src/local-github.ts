/**
 * Read-only GitHub access using this Windows user's existing Git credential
 * helper. Credentials are requested without UI and live only in this process;
 * disabling this connection never changes Git's account or credential store.
 * This is an Apps port: callers must keep the normal appCall approval pipeline.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type AppDirectory, type Rules, kinds, permissionOf } from "@amuse/core";
import type { Apps } from "@amuse/pi";
import type { App, Account, Permission } from "@amuse/protocol";
import { z } from "zod";

export const LOCAL_GITHUB_APP = "local-github";
export const isLocalGitHubAction = (slug: string): boolean => slug.startsWith("LOCAL_GITHUB_");
export const isLocalGitHubAccount = (account: string): boolean => account.startsWith("local-github:");
export const localGitHubApp: App = {
  id: LOCAL_GITHUB_APP,
  name: "GitHub (local Git login)",
  description: "Read repositories, issues and pull requests using the computer's existing Git login. No Composio key or new GitHub permission is required. Disconnecting only disables Amuse access.",
  logo: null,
};

const State = z.object({ version: z.literal(1), enabled: z.boolean() }).strict();
const Profile = z.object({ id: z.number().int(), login: z.string().min(1), name: z.string().nullable(), html_url: z.url() });
const Repository = z.object({
  id: z.number().int(), name: z.string(), full_name: z.string(), private: z.boolean(),
  html_url: z.url(), description: z.string().nullable(), default_branch: z.string(),
  archived: z.boolean(), updated_at: z.string().nullable(),
});
const Author = z.object({ login: z.string() }).nullable();
const Issue = z.object({
  number: z.number().int(), title: z.string(), state: z.string(), html_url: z.url(),
  body: z.string().nullable(), user: Author, updated_at: z.string(),
  pull_request: z.object({ url: z.url().optional() }).optional(),
});
const PullRequest = z.object({
  number: z.number().int(), title: z.string(), state: z.string(), html_url: z.url(),
  body: z.string().nullable(), user: Author, draft: z.boolean().optional(),
  head: z.object({ ref: z.string() }), base: z.object({ ref: z.string() }),
  updated_at: z.string(), merged_at: z.string().nullable().optional(),
});
const page = { page: z.number().int().min(1).max(10000).default(1), per_page: z.number().int().min(1).max(100).default(30) };
const segment = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).refine((value) => value !== "." && value !== "..");
const repo = { owner: segment, repo: segment };
const item = { ...repo, number: z.number().int().positive() };
const state = z.enum(["open", "closed", "all"]).default("open");
const noArgs = z.object({}).strict();

const definitions = [
  { slug: "LOCAL_GITHUB_GET_PROFILE", name: "Read GitHub login", description: "Read the profile of the computer's existing GitHub Git login. Private email and credentials are not returned.", schema: noArgs },
  { slug: "LOCAL_GITHUB_LIST_REPOSITORIES", name: "List GitHub repositories", description: "Read repositories accessible to the existing Git login; results may include private repositories. Supports pagination.", schema: z.object({ ...page, sort: z.enum(["created", "updated", "pushed", "full_name"]).default("updated") }).strict() },
  { slug: "LOCAL_GITHUB_LIST_ISSUES", name: "List repository issues", description: "Read a repository's GitHub issue feed, which also includes pull requests marked is_pull_request. Supports state and pagination.", schema: z.object({ ...repo, ...page, state }).strict() },
  { slug: "LOCAL_GITHUB_GET_ISSUE", name: "Read a GitHub issue", description: "Read an issue's title, body, state and author. This does not add comments or change the issue.", schema: z.object(item).strict() },
  { slug: "LOCAL_GITHUB_LIST_PULL_REQUESTS", name: "List repository pull requests", description: "Read a repository's pull requests, including source and target branches. Supports state and pagination.", schema: z.object({ ...repo, ...page, state }).strict() },
  { slug: "LOCAL_GITHUB_GET_PULL_REQUEST", name: "Read a GitHub pull request", description: "Read one pull request and its source/target branches. This does not merge, review or edit it.", schema: z.object(item).strict() },
] as const;

export class LocalGitHubUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "LocalGitHubUnavailable"; }
}

/** Read an already-stored credential; never prompt for login or print helper output. */
export function gitCredential(options: { executable?: string; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable ?? "git", ["credential", "fill"], {
      ...(options.cwd ? { cwd: options.cwd } : {}), windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GCM_INTERACTIVE: "Never", GIT_TERMINAL_PROMPT: "0" },
    });
    let output = "";
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output = "";
      if (error) reject(error); else resolve(token!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new LocalGitHubUnavailable("The existing Git login did not respond in time."));
    }, 15000);
    child.stdout.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > 65536) { child.kill(); finish(new LocalGitHubUnavailable("The Git credential helper returned an invalid response.")); return; }
      output += part.toString("utf8");
    });
    // Drain without retaining credential-helper diagnostics: providers may put secrets there.
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.once("error", () => finish(new LocalGitHubUnavailable("Git is unavailable on this computer.")));
    child.once("close", (code) => {
      if (settled) return;
      const token = output.split(/\r?\n/).find((line) => line.startsWith("password="))?.slice("password=".length);
      if (code !== 0 || !token || /[\r\n\0]/.test(token)) {
        finish(new LocalGitHubUnavailable("No existing GitHub Git login is available. Sign in with Git on the computer, then reconnect here."));
      } else finish(undefined, token);
    });
    child.stdin.end("protocol=https\nhost=github.com\n\n");
  });
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new LocalGitHubUnavailable("GitHub returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4_000_000) throw new LocalGitHubUnavailable("GitHub returned too much data; request a smaller page.");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new LocalGitHubUnavailable("GitHub returned an invalid JSON response."); }
}

export interface LocalGitHubOptions {
  rules: Rules;
  /** Only {version, enabled} is stored here. No credential is written. */
  statePath: string;
  /** Existing Amuse /connected page, used only after the local login is verified. */
  connectedUrl?: string;
  git?: { executable?: string; cwd?: string };
  /** Dependency injection for meaningful offline tests. Production uses gitCredential. */
  credential?: () => Promise<string>;
  http?: typeof fetch;
}

export function localGitHub(options: LocalGitHubOptions) {
  const http = options.http ?? fetch;
  const credential = options.credential ?? (() => gitCredential(options.git));
  const enabled = (): boolean => {
    if (!existsSync(options.statePath)) return true;
    try { return State.parse(JSON.parse(readFileSync(options.statePath, "utf8"))).enabled; }
    catch { throw new LocalGitHubUnavailable("The local GitHub connection setting is invalid; repair it on the computer."); }
  };
  const writeEnabled = (value: boolean) => {
    mkdirSync(dirname(options.statePath), { recursive: true });
    const temporary = `${options.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, enabled: value })}\n`, { mode: 0o600 });
    renameSync(temporary, options.statePath);
  };
  async function read<T>(token: string, path: string, schema: z.ZodType<T>, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`https://api.github.com${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    try {
      const response = await http(url, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Amuse-local-GitHub" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        const detail = response.status === 401 ? " The computer's Git login needs to be renewed." : response.status === 404 ? " The repository or item is unavailable to this Git login." : "";
        throw new LocalGitHubUnavailable(`GitHub returned HTTP ${response.status}.${detail}`);
      }
      const parsed = schema.safeParse(await boundedJson(response));
      if (!parsed.success) throw new LocalGitHubUnavailable("GitHub returned an unexpected response format.");
      return parsed.data;
    } catch (error) {
      if (error instanceof LocalGitHubUnavailable) throw error;
      throw new LocalGitHubUnavailable("GitHub could not be reached. Check the computer's network and retry.");
    }
  }
  const definition = (slug: string) => {
    const found = definitions.find((tool) => tool.slug === slug);
    if (!found) throw new LocalGitHubUnavailable("This connection only supports its listed read-only GitHub actions.");
    return found;
  };
  const requireApp = (app: string) => {
    if (app !== LOCAL_GITHUB_APP) throw new LocalGitHubUnavailable("This is the local-github connection.");
  };
  const profile = async (ignoreDisabled = false) => {
    if (!ignoreDisabled && !enabled()) throw new LocalGitHubUnavailable("Local GitHub access is disconnected in Amuse. Reconnect in Settings > Connections.");
    const token = await credential();
    return { token, user: await read(token, "/user", Profile) };
  };
  const account = (login: string): string => `local-github:${login}`;
  const accounts = async (): Promise<Account[]> => {
    if (!enabled()) return [];
    try {
      const { user } = await profile();
      return [{ id: account(user.login), app: localGitHubApp, label: user.login, status: "active", since: null }];
    } catch (error) {
      if (error instanceof LocalGitHubUnavailable) return [];
      throw error;
    }
  };
  const permission = async (slug: string): Promise<Permission> => {
    definition(slug);
    return permissionOf("read", await options.rules.of(LOCAL_GITHUB_APP));
  };
  const apps: Apps = {
    async accounts(app) { requireApp(app); return (await accounts()).map(({ id, label }) => ({ id, label })); },
    async tools(app, query) {
      requireApp(app);
      const chosen = await options.rules.of(LOCAL_GITHUB_APP);
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const ranked = definitions.map((tool) => ({ tool, score: words.reduce((total, word) => total
        + (`${tool.slug} ${tool.name}`.toLowerCase().includes(word) ? 3 : 0)
        + (tool.description.toLowerCase().includes(word) ? 1 : 0), 0) }));
      const matching = ranked.filter((entry) => !words.length || entry.score > 0);
      return (matching.length ? matching : ranked).sort((a, b) => b.score - a.score).map(({ tool }) => {
        const schema = z.toJSONSchema(tool.schema);
        return { slug: tool.slug, name: tool.name, description: tool.description, parameters: schema.properties ?? {}, required: schema.required ?? [], permission: permissionOf("read", chosen) };
      });
    },
    async permission(app, slug) { requireApp(app); return permission(slug); },
    async kind(slug) { definition(slug); return "read"; },
    async remember(app, slug, value) { requireApp(app); definition(slug); await options.rules.set(LOCAL_GITHUB_APP, "read", value); },
    async call(slug, args, askedAccount) {
      try {
        const tool = definition(slug);
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) throw new LocalGitHubUnavailable("Invalid arguments for this read-only GitHub action. Look up its schema with app_tools.");
        if (await permission(slug) === "deny") throw new LocalGitHubUnavailable("The user's local-github Read permissions rule denies this action. Do not work around that rule.");
        const { token, user } = await profile();
        if (askedAccount !== account(user.login)) throw new LocalGitHubUnavailable("That account does not match the computer's current GitHub Git login. Look up local-github accounts again.");
        const value = parsed.data as Record<string, string | number>;
        const path = "owner" in value ? `/repos/${encodeURIComponent(value["owner"]!)}/${encodeURIComponent(value["repo"]!)}` : "";
        const pagination = { page: value["page"]!, per_page: value["per_page"]! };
        let data: unknown;
        switch (slug) {
          case "LOCAL_GITHUB_GET_PROFILE": data = user; break;
          case "LOCAL_GITHUB_LIST_REPOSITORIES": data = await read(token, "/user/repos", z.array(Repository), { ...pagination, sort: value["sort"]!, direction: "desc" }); break;
          case "LOCAL_GITHUB_LIST_ISSUES": data = (await read(token, `${path}/issues`, z.array(Issue), { ...pagination, state: value["state"]! })).map(({ pull_request, ...issue }) => ({ ...issue, is_pull_request: !!pull_request })); break;
          case "LOCAL_GITHUB_GET_ISSUE": { const { pull_request, ...issue } = await read(token, `${path}/issues/${value["number"]}`, Issue); data = { ...issue, is_pull_request: !!pull_request }; break; }
          case "LOCAL_GITHUB_LIST_PULL_REQUESTS": data = await read(token, `${path}/pulls`, z.array(PullRequest), { ...pagination, state: value["state"]! }); break;
          case "LOCAL_GITHUB_GET_PULL_REQUEST": data = await read(token, `${path}/pulls/${value["number"]}`, PullRequest); break;
          default: throw new LocalGitHubUnavailable("Unknown read-only GitHub action.");
        }
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: error instanceof LocalGitHubUnavailable ? error.message : "The local GitHub connection could not complete this read." };
      }
    },
  };
  const connect = async (): Promise<string> => {
    await profile(true);
    writeEnabled(true);
    return options.connectedUrl ?? "https://github.com/";
  };
  const directory: AppDirectory = {
    async search(query, cursor) {
      const haystack = `${localGitHubApp.id} ${localGitHubApp.name} ${localGitHubApp.description}`.toLowerCase();
      const matches = query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
      return { apps: !cursor && matches ? [localGitHubApp] : [], cursor: null };
    },
    accounts,
    async connect(app) { requireApp(app); return connect(); },
    async disconnect(id) {
      if (!isLocalGitHubAccount(id)) throw new LocalGitHubUnavailable("This is not a local GitHub account.");
      // This is an Amuse-only switch. Never call `git credential reject` / GCM erase.
      writeEnabled(false);
    },
    async permissions(app) {
      requireApp(app);
      const chosen = await options.rules.of(app);
      return kinds.map((kind) => ({ kind, permission: permissionOf(kind, chosen), chosen: chosen[kind] !== undefined }));
    },
    async permit(app, kind, value) { requireApp(app); await options.rules.set(app, kind, value); },
  };
  return {
    apps, directory, connect,
    async status(): Promise<{ enabled: boolean; connected: boolean; login: string | null; reason: string | null }> {
      if (!enabled()) return { enabled: false, connected: false, login: null, reason: "Disabled in Amuse." };
      try { const { user } = await profile(); return { enabled: true, connected: true, login: user.login, reason: null }; }
      catch (error) { return { enabled: true, connected: false, login: null, reason: error instanceof LocalGitHubUnavailable ? error.message : "The existing Git login is unavailable." }; }
    },
  };
}
