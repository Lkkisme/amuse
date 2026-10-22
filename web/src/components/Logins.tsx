/**
 * Settings › Saved logins: the sites Amuse's browsers keep the user signed in
 * to (from their own sign-ins, kept so they need not sign in again), and
 * signing out of one: its kept login goes, from every open browser too. The
 * cookies themselves are never shown.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, KeyRound } from "lucide-react";
import type { Session } from "@amuse/protocol";
import { Sheet } from "./Sheet";
import { useT } from "../i18n/react.ts";

export function Logins({ session }: { session: Session }) {
  const t = useT();
  const [sites, setSites] = useState<
    { site: string; cookies: number }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      session.call("logins.list", {}).then(
        ({ sites }) => setSites(sites),
        (e: unknown) => {
          setSites([]);
          setError(e instanceof Error ? e.message : String(e));
        },
      ),
    [session],
  );
  useEffect(() => void load(), [load]);

  const signOut = (site: string) => {
    setBusy(true);
    setError(null);
    session
      .call("logins.forget", { site })
      .then(load, (e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setBusy(false);
        setLeaving(null);
      });
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.logins.description}
      </p>
      {error && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}
      <ul
        className="mt-4 divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
        style={{ background: "var(--fill-secondary)" }}
      >
        {sites === null &&
          [0, 1, 2].map((i) => (
            <li key={i} className="py-3">
              <div className="skeleton h-5 w-2/5 rounded" />
            </li>
          ))}
        {sites?.length === 0 && (
          <li
            className="py-3.5 text-[15px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.logins.none}
          </li>
        )}
        {sites?.map(({ site }) => (
          <li key={site} className="flex items-center gap-3 py-2.5">
            <Globe size={18} style={{ color: "var(--icon-secondary)" }} />
            <span
              className="min-w-0 flex-1 truncate text-[16px]"
              style={{ color: "var(--text-primary)" }}
            >
              {site}
            </span>
            <button
              className="hover-fade rounded-full px-2 py-1 text-[14px] font-medium"
              style={{ color: "var(--fill-red)" }}
              onClick={() => setLeaving(site)}
            >
              {t.logins.signOut}
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={leaving !== null} onClose={() => setLeaving(null)} bare>
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
            {t.logins.signOutOf(leaving ?? "")}
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.logins.forgetHelp}
          </p>
          <button
            disabled={busy}
            className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--fill-red)" }}
            onClick={() => leaving && signOut(leaving)}
          >
            {t.logins.signOut}
          </button>
          <button
            className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
            style={{ color: "var(--text-primary)" }}
            onClick={() => setLeaving(null)}
          >
            {t.common.cancel}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
