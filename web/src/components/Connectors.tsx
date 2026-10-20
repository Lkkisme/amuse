/**
 * Settings › Connectors, on the server's app directory (apps.* calls), laid
 * out as Muse's: search every app there is to connect (well over a thousand
 * on Composio), Available and Connected lists (Connect, or View for an app
 * with accounts), and an app's page: its accounts (an app may have several),
 * Add account, Disconnect. Nothing here is local: every list is the
 * server's, asked again when the user comes back from authorizing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, MoreHorizontal, Search } from "lucide-react";
import type { Account, App, Session } from "@remuse/protocol";
import { AppLogo } from "./AppLogo";

type Tab = "available" | "connected";
const TABS: Tab[] = ["available", "connected"];

/** Wait this long after the last keystroke before searching. */
const TYPING_MS = 250;

export function Connectors({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("available");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{
    apps: App[];
    cursor: string | null;
  } | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  /** the app whose page is open */
  const [viewing, setViewing] = useState<App | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** the app or account an action is running for */
  const [busy, setBusy] = useState<string | null>(null);

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));

  const loadAccounts = useCallback(
    () =>
      session
        .call("apps.accounts", {})
        .then(({ accounts }) => setAccounts(accounts), fail),
    [session],
  );
  useEffect(() => void loadAccounts(), [loadAccounts]);
  // back from the provider's page (another tab): see what came of it
  useEffect(() => {
    const back = () =>
      document.visibilityState === "visible" && void loadAccounts();
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
    const timer = setTimeout(
      () => {
        session
          .call("apps.search", { query, cursor: null })
          .then((page) => mine === asked.current && setFound(page), fail);
      },
      query ? TYPING_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [session, query]);
  const more = () => {
    if (!found?.cursor) return;
    const mine = asked.current;
    session
      .call("apps.search", { query, cursor: found.cursor })
      .then((page) => {
        if (mine === asked.current)
          setFound((f) => ({
            apps: [...(f?.apps ?? []), ...page.apps],
            cursor: page.cursor,
          }));
      }, fail);
  };

  /** Open the provider's page in a new tab. The tab opens on the tap itself, or it would be blocked as a popup. */
  const connect = (app: string) => {
    const opened = window.open("", "_blank");
    setBusy(app);
    setError(null);
    session
      .call("apps.connect", { app })
      .then(({ url }) => {
        if (opened) opened.location.href = url;
        else window.location.href = url;
      })
      .catch((e: unknown) => {
        opened?.close();
        fail(e);
      })
      .finally(() => setBusy(null));
  };
  const disconnect = (ids: string[]) => {
    setBusy(ids.join());
    setError(null);
    Promise.all(
      ids.map((account) => session.call("apps.disconnect", { account })),
    )
      .then(() => loadAccounts(), fail)
      .finally(() => setBusy(null));
  };

  const accountsOf = (app: string) =>
    (accounts ?? []).filter((a) => a.app.id === app);
  const connectedApps = byApp(accounts ?? []).map((g) => g.app);
  const shownConnected = connectedApps.filter(
    (a) =>
      !query || `${a.id} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
  );

  const errorLine = error && (
    <p
      role="alert"
      className="mt-3 text-[13px]"
      style={{ color: "var(--fill-red)" }}
    >
      {error}
    </p>
  );

  if (viewing)
    return (
      <AppPage
        app={viewing}
        accounts={accountsOf(viewing.id)}
        busy={busy}
        error={errorLine}
        onBack={() => setViewing(null)}
        onConnect={() => connect(viewing.id)}
        onDisconnect={disconnect}
      />
    );

  const row = (app: App) => (
    <Row
      key={app.id}
      app={app}
      connected={accountsOf(app.id).length > 0}
      onOpen={() => setViewing(app)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 sm:px-6">
      <h2
        className="text-[20px] font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        Connectors
      </h2>
      <label
        className="mt-4 flex h-10 shrink-0 items-center gap-2 rounded-full px-3"
        style={{ background: "var(--fill-secondary)" }}
      >
        <Search size={16} style={{ color: "var(--icon-secondary)" }} />
        <input
          className="w-full bg-transparent text-[15px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div
        className="mt-3 grid h-9 shrink-0 grid-cols-2 rounded-full p-[3px]"
        style={{ background: "var(--fill-secondary)" }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            className="rounded-full text-[14px] font-medium"
            style={
              tab === t
                ? {
                    background: "var(--fill-primary)",
                    color: "var(--text-primary)",
                    boxShadow: "var(--shadow-float)",
                  }
                : { color: "var(--text-secondary)" }
            }
            onClick={() => setTab(t)}
          >
            {t === "available" ? "Available" : "Connected"}
          </button>
        ))}
      </div>
      {errorLine}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-5">
        {tab === "available" ? (
          found === null ? (
            <Note>Loading apps…</Note>
          ) : found.apps.length === 0 ? (
            <Note>No app matches “{query}”.</Note>
          ) : (
            <>
              <Group>{found.apps.map(row)}</Group>
              {found.cursor && (
                <button
                  className="hover-fade mt-2 h-10 w-full rounded-full text-[14px] font-medium"
                  style={{ color: "var(--fill-blue)" }}
                  onClick={more}
                >
                  Show more
                </button>
              )}
            </>
          )
        ) : accounts === null ? (
          <Note>Loading…</Note>
        ) : shownConnected.length === 0 ? (
          <Note>
            {query
              ? `No connected app matches “${query}”.`
              : "Nothing connected yet. Connect apps under Available, or ask Muse to."}
          </Note>
        ) : (
          <Group>{shownConnected.map(row)}</Group>
        )}
      </div>
    </div>
  );
}

/** An app's page: its accounts, adding another, letting go of one or all. */
function AppPage({
  app,
  accounts,
  busy,
  error,
  onBack,
  onConnect,
  onDisconnect,
}: {
  app: App;
  accounts: Account[];
  busy: string | null;
  error: React.ReactNode;
  onBack: () => void;
  onConnect: () => void;
  onDisconnect: (accounts: string[]) => void;
}) {
  /** the account whose options are open */
  const [options, setOptions] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-3 sm:px-6">
      <button
        aria-label="Back"
        className="hover-fade flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{
          background: "var(--fill-primary)",
          color: "var(--icon-primary)",
          boxShadow: "var(--shadow-float)",
        }}
        onClick={onBack}
      >
        <ChevronLeft size={18} />
      </button>
      <div className="mt-2 flex flex-col items-center text-center">
        <AppLogo name={app.name} logo={app.logo} size={48} />
        <p
          className="mt-2 text-[18px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {app.name}
        </p>
        <p
          className="mt-0.5 max-w-[360px] text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {app.description || "Muse can use the accounts you connect."}
        </p>
      </div>
      {error}
      {accounts.length > 0 && (
        <Group className="mt-5">
          <li>
            <button
              disabled={busy === accounts.map((a) => a.id).join()}
              className="hover-fade w-full py-3.5 text-left text-[15px] disabled:opacity-50"
              style={{ color: "var(--fill-red)" }}
              onClick={() => onDisconnect(accounts.map((a) => a.id))}
            >
              Disconnect
            </button>
          </li>
        </Group>
      )}
      {accounts.length === 0 ? (
        <button
          disabled={busy === app.id}
          className="mx-auto mt-5 h-10 w-full max-w-[280px] rounded-full text-[15px] font-medium text-white disabled:opacity-50"
          style={{ background: "var(--fill-blue)" }}
          onClick={onConnect}
        >
          Connect
        </button>
      ) : (
        <Group className="mt-3">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="relative flex items-center gap-3 py-2.5"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-medium"
                style={{
                  background: "var(--fill-primary)",
                  color: "var(--text-secondary)",
                }}
              >
                {(account.label ?? app.name).charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[15px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {account.label ?? app.name}
                </span>
                {account.status !== "active" && (
                  <span
                    className="block text-[12px]"
                    style={{ color: "var(--fill-orange)" }}
                  >
                    {account.status === "expired"
                      ? "Expired: connect it again"
                      : "Failed: connect it again"}
                  </span>
                )}
              </span>
              <button
                aria-label={`Options for ${account.label ?? app.name}`}
                className="hover-fade flex size-8 items-center justify-center rounded-full"
                style={{
                  background: "var(--fill-primary)",
                  color: "var(--icon-secondary)",
                }}
                onClick={() =>
                  setOptions((o) => (o === account.id ? null : account.id))
                }
              >
                <MoreHorizontal size={16} />
              </button>
              {options === account.id && (
                <div
                  role="menu"
                  className="anim-popover-in absolute right-0 top-full z-10 w-max min-w-44 rounded-2xl p-1.5 whitespace-nowrap"
                  style={{
                    background: "var(--fill-primary)",
                    boxShadow: "var(--shadow-raised)",
                  }}
                >
                  {account.status !== "active" && (
                    <MenuItem
                      onClick={() => {
                        setOptions(null);
                        onConnect();
                      }}
                    >
                      Connect again
                    </MenuItem>
                  )}
                  <MenuItem
                    danger
                    onClick={() => {
                      setOptions(null);
                      onDisconnect([account.id]);
                    }}
                  >
                    Disconnect this account
                  </MenuItem>
                </div>
              )}
            </li>
          ))}
          <li>
            <button
              className="hover-fade w-full py-3 text-left text-[15px]"
              style={{ color: "var(--fill-blue)" }}
              onClick={onConnect}
            >
              Add account
            </button>
          </li>
        </Group>
      )}
    </div>
  );
}

/** Rows in one rounded box, divided by hairlines (Muse's lists). */
const Group = ({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <ul
    className={`divide-y divide-[var(--fill-divider)] rounded-[18px] px-4 ${className}`}
    style={{
      background: "var(--fill-secondary)",
      borderColor: "var(--fill-divider)",
    }}
  >
    {children}
  </ul>
);

/** An app in a list: the whole row opens its page; on the right, what is there to do (Muse). */
function Row({
  app,
  connected,
  onOpen,
}: {
  app: App;
  connected: boolean;
  onOpen: () => void;
}) {
  return (
    <li style={{ borderColor: "var(--fill-divider)" }}>
      <button
        className="hover-fade flex w-full items-center gap-3 py-2.5 text-left"
        onClick={onOpen}
      >
        <AppLogo name={app.name} logo={app.logo} size={32} />
        <span
          className="min-w-0 flex-1 truncate text-[15px]"
          style={{ color: "var(--text-primary)" }}
        >
          {app.name}
        </span>
        <span
          className="shrink-0 px-1 text-[15px]"
          style={{ color: "var(--fill-blue)" }}
        >
          {connected ? "View" : "Connect"}
        </span>
      </button>
    </li>
  );
}

const MenuItem = ({
  danger = false,
  onClick,
  children,
}: {
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    role="menuitem"
    className="hover-fade block w-full rounded-xl px-3 py-2 text-left text-[14px]"
    style={{ color: danger ? "var(--fill-red)" : "var(--text-primary)" }}
    onClick={onClick}
  >
    {children}
  </button>
);

/** Accounts under their app, apps in the order their first account came. */
function byApp(accounts: Account[]): { app: App; accounts: Account[] }[] {
  const groups = new Map<string, { app: App; accounts: Account[] }>();
  for (const account of accounts) {
    const group = groups.get(account.app.id);
    if (group) group.accounts.push(account);
    else groups.set(account.app.id, { app: account.app, accounts: [account] });
  }
  return [...groups.values()];
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p
    className="py-6 text-center text-[14px]"
    style={{ color: "var(--text-secondary)" }}
  >
    {children}
  </p>
);
