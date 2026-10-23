/**
 * Settings › Connections, behind their own key: services are connected through
 * Composio, with the user's Composio API key. Without one, the page asks for
 * it; with one, it shows the connections, and below them the key (only its
 * end), which opens what can be done with it: test, replace, remove.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, KeyRound, LayoutGrid } from "lucide-react";
import type { App, KeyProvider, Session } from "@amuse/protocol";
import { Button } from "./Button";
import { Connectors } from "./Connectors";
import { KeyLine, KeyLogin, useKeyTests } from "./KeyLogin";
import { Sheet } from "./Sheet";
import { useT } from "../i18n/react.ts";

/** `demo`: the in-browser demo, whose connectors are scripted and need no key. */
export function AppsKey({
  session,
  demo,
  viewing,
  onView,
}: {
  session: Session;
  demo: boolean;
  viewing: App | null;
  onView: (app: App | null) => void;
}) {
  const t = useT();
  const [key, setKey] = useState<KeyProvider | null | undefined>(undefined);
  const [setting, setSetting] = useState<KeyProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { tests, test, clear } = useKeyTests(session);
  const [managing, setManaging] = useState(false);
  const load = useCallback(
    () =>
      session.call("keys.list", {}).then(
        ({ providers }) =>
          setKey(providers.find((p) => p.use === "apps") ?? null),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [session],
  );
  useEffect(() => void (demo ? undefined : load()), [load, demo]);
  const sheet = (
    <KeyLogin
      session={session}
      provider={setting}
      onClose={(done) => {
        // a key just set up is tried at once
        if (done && setting) test(setting.id);
        setSetting(null);
        if (done) void load();
      }}
    />
  );

  if (demo)
    return <Connectors session={session} viewing={viewing} onView={onView} />;
  if (key === undefined)
    return (
      <div className="flex-1 px-5 sm:px-6">
        {error ? (
          <p className="text-[13px]" style={{ color: "var(--fill-red)" }}>
            {error}
          </p>
        ) : (
          // loading: the shape of the page to come
          <div aria-label={t.connections.loading} className="space-y-3">
            <div className="skeleton h-10 rounded-full" />
            <div className="skeleton h-9 rounded-full" />
            <div className="skeleton h-64 rounded-[18px]" />
          </div>
        )}
      </div>
    );
  if (key === null || !key.connected)
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-10 text-center">
        <LayoutGrid size={28} style={{ color: "var(--icon-secondary)" }} />
        <p
          className="mt-3 text-[16px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {t.connections.connectTitle}
        </p>
        <p
          className="mt-1 max-w-[300px] text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.connections.connectHelp}
        </p>
        <p
          className="mt-2 max-w-[300px] text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.connections.ownAccount}
        </p>
        {/* where the key is, per Composio's docs */}
        <ol
          className="mt-5 w-full max-w-[320px] space-y-2.5 rounded-[18px] px-4 py-3.5 text-left text-[14px]"
          style={{
            background: "var(--fill-secondary)",
            color: "var(--text-primary)",
          }}
        >
          {[
            <>
              {t.connections.steps.signIn}
              <a
                href="https://dashboard.composio.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "var(--fill-blue)" }}
              >
                dashboard.composio.dev
              </a>
              {t.connections.steps.signInAfter}
            </>,
            <>{t.connections.steps.openSettings}</>,
            <>{t.connections.steps.copyKey}</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                style={{
                  background: "var(--fill-primary)",
                  color: "var(--text-secondary)",
                }}
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {key && (
          <Button
            variant="primary"
            className="mt-5"
            onClick={() => setSetting(key)}
          >
            {t.connections.addKey}
          </Button>
        )}
        {sheet}
      </div>
    );
  return (
    <>
      <Connectors session={session} viewing={viewing} onView={onView} />
      {/* the key: one row; what can be done with it opens over it */}
      {!viewing && (
        <button
          className="flex shrink-0 items-center gap-3 border-t px-5 py-3 text-left sm:px-6"
          style={{ borderColor: "var(--fill-divider)" }}
          onClick={() => setManaging(true)}
        >
          <span className="min-w-0 flex-1">
            <span
              className="block text-[15px]"
              style={{ color: "var(--text-primary)" }}
            >
              Composio
            </span>
            <KeyLine hint={key.hint} test={tests[key.id]} brief />
          </span>
          <ChevronRight size={16} style={{ color: "var(--icon-secondary)" }} />
        </button>
      )}
      <Sheet open={managing} onClose={() => setManaging(false)} bare>
        <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
          <span
            className="flex size-14 items-center justify-center rounded-[16px]"
            style={{ background: "#ffffff", color: "#111112" }}
          >
            <KeyRound size={26} />
          </span>
          <p
            className="mt-4 text-[20px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Composio
          </p>
          <div
            className="mt-4 w-full rounded-[18px] px-4 py-3 text-left"
            style={{ background: "var(--field)" }}
          >
            <KeyLine hint={key.hint} test={tests[key.id]} />
          </div>
          <ul
            className="mt-3 w-full divide-y divide-[var(--fill-divider)] rounded-[18px] px-4 text-left"
            style={{ background: "var(--field)" }}
          >
            <li>
              <button
                disabled={tests[key.id] === "testing"}
                className="hover-fade w-full py-3.5 text-left text-[16px] disabled:opacity-50"
                style={{ color: "var(--fill-blue)" }}
                onClick={() => test(key.id)}
              >
                {t.keys.testKey}
              </button>
            </li>
            <li>
              <button
                className="hover-fade w-full py-3.5 text-left text-[16px]"
                style={{ color: "var(--fill-blue)" }}
                onClick={() => {
                  setManaging(false);
                  setSetting(key);
                }}
              >
                {t.keys.replaceKey}
              </button>
            </li>
            <li>
              <button
                className="hover-fade w-full py-3.5 text-left text-[16px]"
                style={{ color: "var(--fill-red)" }}
                onClick={() => {
                  setManaging(false);
                  clear(key.id);
                  void session
                    .call("keys.logout", { provider: key.id })
                    .then(load);
                }}
              >
                {t.keys.removeKey}
              </button>
            </li>
          </ul>
          <Button
            variant="plain"
            size="lg"
            className="mt-2"
            onClick={() => setManaging(false)}
          >
            {t.common.done}
          </Button>
        </div>
      </Sheet>
      {sheet}
    </>
  );
}
