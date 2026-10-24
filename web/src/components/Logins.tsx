/**
 * Settings › Browser data: the sites Amuse's browsers keep the user signed in
 * to (cookies and storage from their own sign-ins, kept so they need not sign
 * in again; no passwords), and signing out of one: what is kept for it goes,
 * from every open browser too. The cookies themselves are never shown.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, KeyRound } from "lucide-react";
import type { Session } from "@amuse/protocol";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
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
            <Button onCard tone="danger" onClick={() => setLeaving(site)}>
              {t.logins.signOut}
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmSheet
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        icon={KeyRound}
        title={t.logins.signOutOf(leaving ?? "")}
        body={t.logins.forgetHelp}
        action={t.logins.signOut}
        busy={busy}
        onConfirm={() => leaving && signOut(leaving)}
      />
    </div>
  );
}
