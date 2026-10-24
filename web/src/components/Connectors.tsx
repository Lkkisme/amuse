/**
 * Settings › Connections, on the server's directory (apps.* calls), laid
 * out as Muse's: search every service there is to connect (well over a thousand
 * on Composio), Available and Connected lists (Connect, or View for an app
 * with accounts), and an app's page: its accounts (an app may have several),
 * Add account, Disconnect. Nothing here is local: every list is the
 * server's, asked again when the user comes back from authorizing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, MoreHorizontal, Search } from "lucide-react";
import type {
  Account,
  App,
  AppAccess,
  GivenField,
  KindRule,
  Permission,
  Session,
  ToolKind,
} from "@amuse/protocol";
import { Button } from "./Button";
import { AppLogo } from "./AppLogo";
import { KeyConnect } from "./KeyConnect";
import { PermissionSelect } from "./PermissionSelect";
import { useT } from "../i18n/react.ts";
import { type Failures, failedAt, noFailures, pageLeft, wentThrough, wordsFor } from "../shown.ts";

type Tab = "available" | "connected";
const TABS: Tab[] = ["available", "connected"];

/** Wait this long after the last keystroke before searching. */
const TYPING_MS = 250;

/** `viewing`: the app whose page is open (the settings' own state, so a phone's back button can leave it). */
export function Connectors({
  session,
  viewing,
  onView,
}: {
  session: Session;
  viewing: App | null;
  onView: (app: App | null) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("available");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{
    apps: App[];
    cursor: string | null;
  } | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  /** what failed where: the list's own (a search, the accounts), and the open app's (the list never shows that one) */
  const [failures, setFailures] = useState<Failures>(noFailures);
  /** the app or account an action is running for */
  const [busy, setBusy] = useState<string | null>(null);
  /** how many times the open app's access has been asked about: a return to the page asks again */
  const [askedAgain, setAskedAgain] = useState(0);

  const fail = (e: unknown) => setFailures((was) => failedAt(was, "list", e));
  const failPage = (e: unknown) => setFailures((was) => failedAt(was, "page", e));
  /** the app whose page is open, for a call that may have been made from the list or from a page */
  const opened = useRef<string | null>(null);

  const loadAccounts = useCallback(
    () =>
      session
        .call("apps.accounts", {})
        .then(
          ({ accounts }) => {
            setAccounts(accounts);
            // it went through: a failure that was the connection dropping does not stand
            setFailures(wentThrough);
          },
          (e: unknown) => setFailures((was) => failedAt(was, opened.current ? "page" : "list", e)),
        ),
    [session],
  );
  useEffect(() => void loadAccounts(), [loadAccounts]);
  // back from the provider's page (another tab), or from another app on a phone: see what came of it, and ask
  // again about the app on screen (its answer, too, may have been the connection dropping while the page was away)
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible") return;
      void loadAccounts();
      setAskedAgain((n) => n + 1);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
    window.addEventListener("online", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
      window.removeEventListener("online", back);
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
          .then((page) => {
            if (mine !== asked.current) return;
            setFound(page);
            setFailures((was) => failedAt(was, "list", null)); // the search worked: nothing left to say about the list
          }, fail);
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
    const tab = window.open("", "_blank");
    setBusy(app);
    setFailures((was) => failedAt(was, "page", null));
    session
      .call("apps.connect", { app })
      .then(({ url }) => {
        if (tab) tab.location.href = url;
        else window.location.href = url;
      })
      .catch((e: unknown) => {
        tab?.close();
        failPage(e);
      })
      .finally(() => setBusy(null));
  };
  // how the open app is connected: a link, or the user's own key. Asked when the page opens and again when the
  // user comes back to it; `access` is kept across a return, so a key typed into the field is not lost.
  const [access, setAccess] = useState<AppAccess | null>(null);
  const viewingId = viewing?.id;
  useEffect(() => {
    if (!viewingId) return;
    let current = true;
    session.call("apps.access", { app: viewingId }).then(
      ({ access }) => current && setAccess(access),
      (e: unknown) => current && failPage(e),
    );
    return () => {
      current = false;
    };
  }, [session, viewingId, askedAgain]);
  // the app whose page is open, and nothing of its own failure left behind when the user leaves it
  opened.current = viewingId ?? null;
  useEffect(() => setFailures(pageLeft), [viewingId]);
  useEffect(() => setAccess(null), [viewingId]);
  /** the key goes to the server and on to Composio, nowhere else; then the accounts are read again */
  const connectKey = async (app: string, values: GivenField[]) => {
    await session.call("apps.connectKey", { app, values });
    await loadAccounts();
  };
  const disconnect = (ids: string[]) => {
    setBusy(ids.join());
    setFailures((was) => failedAt(was, "page", null));
    Promise.all(
      ids.map((account) => session.call("apps.disconnect", { account })),
    )
      .then(() => loadAccounts(), failPage)
      .finally(() => setBusy(null));
  };

  const accountsOf = (app: string) =>
    (accounts ?? []).filter((a) => a.app.id === app);
  const connectedApps = byApp(accounts ?? []).map((g) => g.app);
  const shownConnected = connectedApps.filter(
    (a) =>
      !query || `${a.id} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
  );

  // the list shows its own failures only: one about the app whose page is open stays on that page
  const listSaid = wordsFor(failures.list, t);
  const errorLine = listSaid && (
    <p
      role="alert"
      className="mt-3 text-[13px]"
      style={{ color: "var(--fill-red)" }}
    >
      {listSaid}
    </p>
  );

  if (viewing)
    return (
      <AppPage
        session={session}
        app={viewing}
        accounts={accountsOf(viewing.id)}
        busy={busy}
        access={access}
        error={wordsFor(failures.page, t)}
        onConnectKey={(values) => connectKey(viewing.id, values)}
        onBack={() => onView(null)}
        onConnect={() => connect(viewing.id)}
        onDisconnect={disconnect}
      />
    );

  const row = (app: App) => (
    <Row
      key={app.id}
      app={app}
      connected={accountsOf(app.id).length > 0}
      onOpen={() => onView(app)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 sm:px-6">
      <label
        className="flex h-10 shrink-0 items-center gap-2 rounded-full px-3"
        style={{ background: "var(--fill-secondary)" }}
      >
        <Search size={16} style={{ color: "var(--icon-secondary)" }} />
        <input
          className="w-full bg-transparent text-[15px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder={t.connections.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div
        className="mt-3 grid h-9 shrink-0 grid-cols-2 rounded-full p-[3px]"
        style={{ background: "var(--fill-secondary)" }}
      >
        {TABS.map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            className="rounded-full text-[14px] font-medium"
            style={
              tab === option
                ? {
                    background: "var(--segment-selected)",
                    color: "var(--text-primary)",
                    boxShadow: "var(--shadow-float)",
                  }
                : { color: "var(--text-secondary)" }
            }
            onClick={() => setTab(option)}
          >
            {option === "available" ? t.connections.available : t.connections.connected}
          </button>
        ))}
      </div>
      {errorLine}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-5">
        {tab === "available" ? (
          found === null ? (
            <Note>{t.connections.loadingApps}</Note>
          ) : found.apps.length === 0 ? (
            <Note>{t.connections.noMatch(query)}</Note>
          ) : (
            <>
              <Group>{found.apps.map(row)}</Group>
              {found.cursor && (
                <Button
                  variant="plain"
                  tone="accent"
                  className="mt-2 w-full"
                  onClick={more}
                >
                  {t.connections.showMore}
                </Button>
              )}
            </>
          )
        ) : accounts === null ? (
          <Note>{t.connections.loading}</Note>
        ) : shownConnected.length === 0 ? (
          <Note>
            {query ? t.connections.noMatch(query) : t.connections.nothingConnected}
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
  session,
  app,
  accounts,
  busy,
  access,
  error,
  onConnectKey,
  onBack,
  onConnect,
  onDisconnect,
}: {
  session: Session;
  app: App;
  accounts: Account[];
  busy: string | null;
  access: AppAccess | null;
  error: string | null;
  onConnectKey: (values: GivenField[]) => Promise<void>;
  onBack: () => void;
  onConnect: () => void;
  onDisconnect: (accounts: string[]) => void;
}) {
  const t = useT();
  /** the account whose options are open */
  const [options, setOptions] = useState<string | null>(null);
  const [rules, setRules] = useState<KindRule[] | null>(null);
  const load = useCallback(
    () =>
      session.call("apps.permissions", { app: app.id }).then(
        ({ rules }) => setRules(rules),
        () => setRules([]),
      ),
    [session, app.id],
  );
  useEffect(() => void load(), [load]);
  const permit = (kind: ToolKind, permission: Permission | null) =>
    void session
      .call("apps.permit", { app: app.id, kind, permission })
      .then(load, load);
  return (
    // a block, not a flex column: a flex column would squeeze its rows to fit instead of scrolling them
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 sm:px-6">
      <button
        aria-label={t.common.back}
        // a desktop's way back to the apps (a phone's is in the settings' own bar)
        className="hover-fade hidden size-8 shrink-0 items-center justify-center rounded-full sm:flex"
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
          {app.description || t.connections.useAccounts}
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}
      {accounts.length > 0 && (
        <Group className="mt-5">
          <li>
            <button
              disabled={busy === accounts.map((a) => a.id).join()}
              className="hover-fade w-full py-3.5 text-left text-[15px] disabled:opacity-50"
              style={{ color: "var(--fill-red)" }}
              onClick={() => onDisconnect(accounts.map((a) => a.id))}
            >
              {t.connections.disconnect}
            </button>
          </li>
        </Group>
      )}
      {accounts.length === 0 ? (
        access?.kind === "key" ? (
          <div className="mt-5">
            <KeyConnect app={app.name} fields={access.fields} connect={onConnectKey} />
          </div>
        ) : (
          <div className="mt-5 flex justify-center">
            <Button
              variant="primary"
              className="w-full max-w-[280px]"
              disabled={busy === app.id || access === null}
              onClick={onConnect}
            >
              {t.connections.connect}
            </Button>
          </div>
        )
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
                      ? t.connections.expired
                      : t.connections.failed}
                  </span>
                )}
              </span>
              <button
                aria-label={t.connections.optionsFor(account.label ?? app.name)}
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
                  {account.status !== "active" && access?.kind !== "key" && (
                    <MenuItem
                      onClick={() => {
                        setOptions(null);
                        onConnect();
                      }}
                    >
                      {t.connections.connectAgain}
                    </MenuItem>
                  )}
                  <MenuItem
                    danger
                    onClick={() => {
                      setOptions(null);
                      onDisconnect([account.id]);
                    }}
                  >
                    {t.connections.disconnectAccount}
                  </MenuItem>
                </div>
              )}
            </li>
          ))}
          {access?.kind !== "key" && (
            <li>
              <button
                className="hover-fade w-full py-3 text-left text-[15px]"
                style={{ color: "var(--fill-blue)" }}
                onClick={onConnect}
              >
                {t.connections.addAccount}
              </button>
            </li>
          )}
        </Group>
      )}
      {accounts.length > 0 && access?.kind === "key" && (
        <div className="mt-4">
          <KeyConnect app={app.name} fields={access.fields} connect={onConnectKey} />
        </div>
      )}
      {rules && rules.length > 0 && (
        <>
          {rules.map((rule) => (
            <section key={rule.kind}>
              <p
                className="mb-1.5 mt-5 px-4 text-[13px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                {t.connections.kinds[rule.kind]}
              </p>
              <Group>
                <li className="flex items-center gap-3 py-3">
                  <span
                    className="min-w-0 flex-1 text-[15px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {t.connections.kindLines[rule.kind]}
                  </span>
                  <PermissionSelect
                    value={rule.permission}
                    onChange={(p) => permit(rule.kind, p)}
                  />
                </li>
              </Group>
            </section>
          ))}
          {rules.some((r) => r.chosen) && (
            <div className="mt-3 flex justify-end">
              <Button
                tone="danger"
                onClick={() =>
                  rules
                    .filter((r) => r.chosen)
                    .forEach((r) => permit(r.kind, null))
                }
              >
                {t.connections.resetDefaults}
              </Button>
            </div>
          )}
        </>
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
  const t = useT();
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
          {connected ? t.connections.view : t.connections.connect}
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
