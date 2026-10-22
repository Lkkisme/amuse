/** Combine local GitHub with cloud connections without changing either's policy. */
import type { AppDirectory, Ports } from "@amuse/core";
import type { Apps } from "@amuse/pi";
import type { App } from "@amuse/protocol";
import { NoComposioKey, composioGuide } from "@amuse/composio";
import { isLocalGitHubAccount, isLocalGitHubAction, LOCAL_GITHUB_APP, LocalGitHubUnavailable, type localGitHub } from "./local-github.ts";

/** Available services are not connected accounts; their real OAuth still runs. */
const pendingCloud: App[] = [
  { id: "gmail", name: "Gmail", description: "Connect Gmail through your Composio account. Google authorization is required before mail can be read or sent.", logo: null },
  { id: "googlecalendar", name: "Google Calendar", description: "Connect Google Calendar through your Composio account. Google authorization is required before calendars can be read or changed.", logo: null },
];
const aliases: Record<string, string> = { gmail: "邮箱 邮件 谷歌 gmail", googlecalendar: "日历 日程 谷歌 calendar googlecalendar" };

export interface LocalAppsOptions {
  local: ReturnType<typeof localGitHub>;
  cloudApps: Apps;
  cloudDirectory: AppDirectory;
  cloudConnect: Ports["connect"];
  hasCloudKey(): boolean;
}

export function localApps(options: LocalAppsOptions) {
  const cloud = () => { if (!options.hasCloudKey()) throw new NoComposioKey(); };
  const forApp = (app: string) => {
    if (app === LOCAL_GITHUB_APP) return options.local.apps;
    cloud(); return options.cloudApps;
  };
  const forAction = (slug: string) => {
    if (isLocalGitHubAction(slug)) return options.local.apps;
    cloud(); return options.cloudApps;
  };
  const matching = (app: string, slug: string) => {
    if ((app === LOCAL_GITHUB_APP) !== isLocalGitHubAction(slug))
      throw new LocalGitHubUnavailable("The action belongs to a different connection. Look up actions for the matching app first.");
  };
  const apps: Apps = {
    accounts: (app) => forApp(app).accounts(app),
    tools: (app, query) => forApp(app).tools(app, query),
    permission: (app, slug) => { matching(app, slug); return forApp(app).permission(app, slug); },
    kind: (slug) => forAction(slug).kind(slug),
    remember: (app, slug, value) => { matching(app, slug); return forApp(app).remember(app, slug, value); },
    async call(slug, args, account) {
      if (isLocalGitHubAction(slug) !== isLocalGitHubAccount(account))
        return { ok: false, error: "The action and account belong to different connections. Look up the matching account first." };
      return forAction(slug).call(slug, args, account);
    },
  };
  const directory: AppDirectory = {
    async search(query, cursor) {
      const local = await options.local.directory.search(query, cursor);
      if (!options.hasCloudKey()) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const found = cursor ? [] : pendingCloud.filter((app) => words.every((word) => `${app.id} ${app.name} ${app.description} ${aliases[app.id] ?? ""}`.toLowerCase().includes(word)));
        return { apps: [...local.apps, ...found], cursor: null };
      }
      const remote = await options.cloudDirectory.search(query, cursor);
      return { apps: [...local.apps, ...remote.apps.filter((app) => app.id !== LOCAL_GITHUB_APP)], cursor: remote.cursor };
    },
    async accounts() {
      const [local, remote] = await Promise.all([
        options.local.directory.accounts(),
        options.hasCloudKey() ? options.cloudDirectory.accounts() : Promise.resolve([]),
      ]);
      return [...local, ...remote];
    },
    connect(app) {
      if (app === LOCAL_GITHUB_APP) return options.local.directory.connect(app);
      cloud(); return options.cloudDirectory.connect(app);
    },
    disconnect(account) {
      if (isLocalGitHubAccount(account)) return options.local.directory.disconnect(account);
      cloud(); return options.cloudDirectory.disconnect(account);
    },
    permissions: (app) => (app === LOCAL_GITHUB_APP ? options.local.directory : options.cloudDirectory).permissions(app),
    permit: (app, kind, value) => (app === LOCAL_GITHUB_APP ? options.local.directory : options.cloudDirectory).permit(app, kind, value),
  };
  const connect: Ports["connect"] = async (connection, io) => {
    if (connection.provider !== LOCAL_GITHUB_APP) { cloud(); return options.cloudConnect(connection, io); }
    const url = await options.local.connect();
    if (io.act({ kind: "connected", id: connection.id }).ok)
      io.report("[connection] Local GitHub is connected using the computer's existing Git login. Only its listed read actions are available; the user's connection rules still apply.");
    return url;
  };
  return {
    apps, directory, connect,
    /** Local reconnect never needs a Composio key; zero-argument callbacks remain compatible. */
    setup: (provider: string): string | null => provider === LOCAL_GITHUB_APP || options.hasCloudKey() ? null : composioGuide,
  };
}
