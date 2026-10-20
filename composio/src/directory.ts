/**
 * The app directory on Composio. Composio has well over a thousand toolkits
 * and its own search matches poorly ("mail" misses Gmail), so the whole list,
 * most used first, is fetched once in a while and searched here: by name and
 * id first, then by description and category, each in order of use.
 */
import { type AppDirectory, type Rules, kinds, permissionOf } from "@remuse/core";
import type { Account, AccountStatus, App } from "@remuse/protocol";
import type { Composio, Toolkit } from "./client.ts";

/** How long the fetched list is good for. */
const FRESH_MS = 12 * 60 * 60_000;
/** Apps per page of results. */
const PAGE = 30;

const app = (t: Toolkit): App => ({ id: t.slug, name: t.name, description: t.description, logo: t.logo });

/** Composio's account statuses, as the user sees them; accounts on their way (INITIATED) are not shown. */
const status = (raw: string): AccountStatus | null => {
  switch (raw) {
    case "ACTIVE":
      return "active";
    case "EXPIRED":
      return "expired";
    case "FAILED":
    case "INACTIVE":
      return "failed";
    default:
      return null;
  }
};

/** How well `t` answers `words`: 2 its name or id has the word, 1 its description does, 0 neither. */
export function score(t: Toolkit, words: string[]): number {
  let total = 0;
  for (const word of words) {
    const name = `${t.slug} ${t.name}`.toLowerCase();
    const about = `${t.description} ${t.categories.join(" ")}`.toLowerCase();
    const s = name.includes(word) ? 2 : about.includes(word) ? 1 : 0;
    if (s === 0) return 0; // every word must match somewhere
    total += s;
  }
  return total;
}

export function composioDirectory(
  client: Pick<Composio, "toolkits" | "accounts" | "remove" | "link">,
  options: { userId: string; rules: Rules; callbackUrl?: string },
): AppDirectory {
  let list: { at: number; toolkits: Promise<Toolkit[]> } | null = null;
  const toolkits = () => {
    if (!list || Date.now() - list.at > FRESH_MS) {
      const fetched = client.toolkits();
      fetched.catch(() => (list = null)); // a failed fetch is tried again next time
      list = { at: Date.now(), toolkits: fetched };
    }
    return list.toolkits;
  };

  return {
    async search(query, cursor) {
      const all = await toolkits();
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      // a stable sort keeps the order of use within each score
      const found = words.length === 0 ? all : all.map((t) => ({ t, s: score(t, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
      const from = Number(cursor ?? 0) || 0;
      const page = found.slice(from, from + PAGE);
      return { apps: page.map(app), cursor: from + PAGE < found.length ? String(from + PAGE) : null };
    },
    async accounts() {
      const [accounts, all] = await Promise.all([client.accounts(options.userId), toolkits()]);
      const bySlug = new Map(all.map((t) => [t.slug, t]));
      return accounts.flatMap((a): Account[] => {
        const s = status(a.status);
        if (!s) return [];
        const t = bySlug.get(a.toolkit);
        return [{ id: a.id, status: s, label: a.label, app: t ? app(t) : { id: a.toolkit, name: a.toolkit, description: "", logo: null } }];
      });
    },
    async connect(appId) {
      return (await client.link(appId, options.userId, options.callbackUrl)).url;
    },
    disconnect: (account) => client.remove(account),
    async permissions(app) {
      const rules = await options.rules.of(app);
      return kinds.map((kind) => ({ kind, permission: permissionOf(kind, rules), chosen: rules[kind] !== undefined }));
    },
    permit: (app, kind, permission) => options.rules.set(app, kind, permission),
  };
}
