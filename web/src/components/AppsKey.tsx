/**
 * Settings › Connectors, behind the apps' own key: apps are connected through
 * Composio, with the user's Composio API key. Without one, the page asks for
 * it; with one, it shows the connectors, and the key (only its end) to
 * replace or remove.
 */
import { useCallback, useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { App, KeyProvider, Session } from "@remuse/protocol";
import { Connectors } from "./Connectors";
import { KeyLogin } from "./KeyLogin";

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
  const [key, setKey] = useState<KeyProvider | null | undefined>(undefined);
  const [setting, setSetting] = useState<KeyProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        setSetting(null);
        if (done) void load();
      }}
    />
  );

  if (demo)
    return <Connectors session={session} viewing={viewing} onView={onView} />;
  if (key === undefined)
    return (
      <div className="flex-1">
        {error && (
          <p className="px-6 text-[13px]" style={{ color: "var(--fill-red)" }}>
            {error}
          </p>
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
          Connect your apps
        </p>
        <p
          className="mt-1 max-w-[300px] text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Muse reaches your mail, calendar and other apps through Composio, with
          your own Composio API key.
        </p>
        {key && (
          <button
            className="mt-5 h-11 rounded-full px-5 text-[15px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => setSetting(key)}
          >
            Add Composio key
          </button>
        )}
        {sheet}
      </div>
    );
  return (
    <>
      <Connectors session={session} viewing={viewing} onView={onView} />
      {!viewing && (
        <div
          className="flex shrink-0 items-center gap-3 border-t px-5 py-3 text-[13px] sm:px-6"
          style={{
            borderColor: "var(--fill-divider)",
            color: "var(--text-secondary)",
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            Composio key {key.hint ?? ""}
          </span>
          <button
            className="hover-fade font-medium"
            style={{ color: "var(--fill-blue)" }}
            onClick={() => setSetting(key)}
          >
            Replace
          </button>
          <button
            className="hover-fade font-medium"
            style={{ color: "var(--fill-red)" }}
            onClick={() =>
              void session.call("keys.logout", { provider: key.id }).then(load)
            }
          >
            Remove
          </button>
        </div>
      )}
      {sheet}
    </>
  );
}
