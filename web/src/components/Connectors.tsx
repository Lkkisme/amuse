/**
 * Settings › Connectors, on the server's app directory (apps.* calls): search
 * every app there is to connect (well over a thousand on Composio), connect
 * one through the provider's hosted page, and see or let go of the accounts
 * connected. Nothing here is local: every list is the server's, asked again
 * when the user comes back from authorizing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Account, App, Session } from "@remuse/protocol";

type Tab = "available" | "connected";
const TABS: Tab[] = ["available", "connected"];

/** Wait this long after the last keystroke before searching. */
const TYPING_MS = 250;

export function Connectors({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("available");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ apps: App[]; cursor: string | null } | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** the app or account an action is running for */
  const [busy, setBusy] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const loadAccounts = useCallback(
    () =>
      session.call("apps.accounts", {}).then(({ accounts }) => setAccounts(accounts), fail),
    [session],
  );
  useEffect(() => void loadAccounts(), [loadAccounts]);
  // back from the provider's page (another tab): see what came of it
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && void loadAccounts();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [loadAccounts]);

  // search as the user types; a newer search makes an older answer moot
  const asked = useRef(0);
  useEffect(() => {
    const mine = ++asked.current;
    const timer = setTimeout(() => {
      session.call("apps.search", { query, cursor: null }).then((page) => mine === asked.current && setFound(page), fail);
    }, query ? TYPING_MS : 0);
    return () => clearTimeout(timer);
  }, [session, query]);
  const more = () => {
    if (!found?.cursor) return;
    const mine = asked.current;
    session.call("apps.search", { query, cursor: found.cursor }).then((page) => {
      if (mine === asked.current) setFound((f) => ({ apps: [...(f?.apps ?? []), ...page.apps], cursor: page.cursor }));
    }, fail);
  };

  /** Open the provider's page in a new tab. The tab opens on the tap itself, or it would be blocked as a popup. */
  const connect = (app: string) => {
    const tab = window.open("", "_blank");
    setBusy(app);
    setError(null);
    session
      .call("apps.connect", { app })
      .then(({ url }) => {
        if (tab) tab.location.href = url;
        else window.location.href = url;
      })
      .catch((e: unknown) => {
        tab?.close();
        fail(e);
      })
      .finally(() => setBusy(null));
  };
  const disconnect = (account: string) => {
    setBusy(account);
    setError(null);
    session
      .call("apps.disconnect", { account })
      .then(() => loadAccounts(), fail)
      .finally(() => setBusy(null));
  };

  const connectedApps = new Set((accounts ?? []).filter((a) => a.status === "active").map((a) => a.app.id));
  const shownAccounts = (accounts ?? []).filter((a) => !query || `${a.app.id} ${a.app.name}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 sm:px-6">
      <h2 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Connectors
      </h2>
      <label className="mt-4 flex h-10 shrink-0 items-center gap-2 rounded-full px-3" style={{ background: "var(--fill-secondary)" }}>
        <Search size={16} style={{ color: "var(--icon-secondary)" }} />
        <input
          className="w-full bg-transparent text-[15px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Search apps"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="mt-3 grid h-9 shrink-0 grid-cols-2 rounded-full p-[3px]" style={{ background: "var(--fill-secondary)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            className="rounded-full text-[14px] font-medium"
            style={tab === t ? { background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "var(--shadow-float)" } : { color: "var(--text-secondary)" }}
            onClick={() => setTab(t)}
          >
            {t === "available" ? "Available" : `Connected${accounts?.length ? ` (${accounts.length})` : ""}`}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px]" style={{ color: "var(--fill-red)" }}>
          {error}
        </p>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-5">
        {tab === "available" ? (
          found === null ? (
            <Note>Loading apps…</Note>
          ) : found.apps.length === 0 ? (
            <Note>No app matches “{query}”.</Note>
          ) : (
            <>
              <ul className="divide-y" style={{ borderColor: "var(--fill-divider)" }}>
                {found.apps.map((app) => (
                  <Row key={app.id} app={app} sub={app.description}>
                    {connectedApps.has(app.id) ? (
                      <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
                        Connected
                      </span>
                    ) : (
                      <Pill disabled={busy === app.id} onClick={() => connect(app.id)}>
                        Connect
                      </Pill>
                    )}
                  </Row>
                ))}
              </ul>
              {found.cursor && (
                <button className="hover-fade mt-2 h-10 w-full rounded-full text-[14px] font-medium" style={{ color: "var(--fill-blue)" }} onClick={more}>
                  Show more
                </button>
              )}
            </>
          )
        ) : accounts === null ? (
          <Note>Loading accounts…</Note>
        ) : shownAccounts.length === 0 ? (
          <Note>{query ? `No connected app matches “${query}”.` : "Nothing connected yet. Connect apps under Available, or ask Muse to."}</Note>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--fill-divider)" }}>
            {shownAccounts.map((account) => (
              <Row key={account.id} app={account.app} sub={account.status === "active" ? "Connected" : account.status === "expired" ? "Expired: connect it again" : "Failed: connect it again"} warn={account.status !== "active"}>
                <div className="flex items-center gap-1.5">
                  {account.status !== "active" && (
                    <Pill disabled={busy === account.app.id} onClick={() => connect(account.app.id)}>
                      Reconnect
                    </Pill>
                  )}
                  <Pill tone="danger" disabled={busy === account.id} onClick={() => disconnect(account.id)}>
                    Disconnect
                  </Pill>
                </div>
              </Row>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ app, sub, warn = false, children }: { app: App; sub: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5" style={{ borderColor: "var(--fill-divider)" }}>
      <Logo app={app} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
          {app.name}
        </span>
        <span className="block truncate text-[13px]" style={{ color: warn ? "var(--fill-orange)" : "var(--text-secondary)" }}>
          {sub}
        </span>
      </span>
      {children}
    </li>
  );
}

/** The app's logo; its initial on a tile where there is none (or it does not load). */
function Logo({ app }: { app: App }) {
  const [broken, setBroken] = useState(false);
  const tile = "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px]";
  if (!app.logo || broken)
    return (
      <span className={`${tile} text-[15px] font-semibold`} style={{ background: "var(--fill-secondary)", color: "var(--text-secondary)" }}>
        {app.name.charAt(0).toUpperCase()}
      </span>
    );
  return (
    <span className={tile} style={{ background: "#fff", border: "1px solid var(--fill-divider)" }}>
      <img src={app.logo} alt="" className="size-6 object-contain" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}

function Pill({ tone = "plain", disabled = false, onClick, children }: { tone?: "plain" | "danger"; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      disabled={disabled}
      className="hover-fade h-8 shrink-0 rounded-full px-3 text-[13px] font-medium disabled:opacity-50"
      style={{ background: "var(--fill-secondary)", color: tone === "danger" ? "var(--fill-red)" : "var(--fill-blue)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="py-6 text-center text-[14px]" style={{ color: "var(--text-secondary)" }}>
    {children}
  </p>
);
