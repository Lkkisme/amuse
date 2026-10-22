/**
 * Settings › Sandbox: Amuse's own machine, where it runs programs and keeps
 * what it installs. Resetting stops what runs in it and wipes its home folder;
 * the workspace (the files shared with the user) is kept, and so is what was
 * installed system-wide, until the container is recreated on the server (see
 * the README). Below, the credentials given for it (on Amuse's cards): what
 * and where, never their values, each to take back.
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Terminal } from "lucide-react";
import type { SecretInfo, Session } from "@amuse/protocol";
import { Sheet } from "./Sheet";
import { useT } from "../i18n/react.ts";
import type { Messages } from "../i18n/en.ts";

export function Sandbox({ session }: { session: Session }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setBusy(true);
    setError(null);
    setDone(false);
    session
      .call("sandbox.reset", {})
      .then(
        () => setDone(true),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.sandbox.description}
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
      {done && (
        <p
          role="status"
          className="mt-2 text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.sandbox.resetDone}
        </p>
      )}
      <ul
        className="mt-4 divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
        style={{ background: "var(--fill-secondary)" }}
      >
        <li className="flex items-center gap-3 py-2.5">
          <Terminal size={18} style={{ color: "var(--icon-secondary)" }} />
          <span
            className="min-w-0 flex-1 truncate text-[16px]"
            style={{ color: "var(--text-primary)" }}
          >
            {t.sandbox.resetRow}
          </span>
          <button
            disabled={busy}
            className="hover-fade rounded-full px-2 py-1 text-[14px] font-medium disabled:opacity-50"
            style={{ color: "var(--fill-red)" }}
            onClick={() => setConfirming(true)}
          >
            {t.common.reset}
          </button>
        </li>
      </ul>

      <Credentials session={session} />

      <Sheet open={confirming} onClose={() => setConfirming(false)} bare>
        <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
          <span
            className="flex size-14 items-center justify-center rounded-[16px]"
            style={{ background: "#ffffff", color: "#111112" }}
          >
            <Terminal size={26} />
          </span>
          <p
            className="mt-4 text-[20px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t.sandbox.resetTitle}
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.sandbox.resetHelp}
          </p>
          <button
            disabled={busy}
            className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--fill-red)" }}
            onClick={reset}
          >
            {t.common.reset}
          </button>
          <button
            className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
            style={{ color: "var(--text-primary)" }}
            onClick={() => setConfirming(false)}
          >
            {t.common.cancel}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

/** Where a credential went, as the user reads it. */
function where(deliver: SecretInfo["deliver"], t: Messages): string {
  if (deliver.kind === "env") return t.sandbox.deliverEnv(deliver.name);
  if (deliver.kind === "file") return t.sandbox.deliverFile(deliver.path.replace(/^~?\/?/, ""));
  return t.sandbox.deliverPane(deliver.pane);
}

function Credentials({ session }: { session: Session }) {
  const t = useT();
  const [secrets, setSecrets] = useState<SecretInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SecretInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      session.call("secrets.list", {}).then(
        ({ secrets }) => setSecrets(secrets),
        () => setSecrets([]),
      ),
    [session],
  );
  useEffect(() => void load(), [load]);

  const remove = (secret: SecretInfo) => {
    setBusy(true);
    setError(null);
    session
      .call("secrets.remove", { id: secret.id })
      .then(load, (e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setBusy(false);
        setRemoving(null);
      });
  };

  return (
    <section className="mt-6">
      <p
        className="mb-2 text-[13px] font-semibold"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.sandbox.credentials}
      </p>
      {error && (
        <p
          role="alert"
          className="mb-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}
      <ul
        className="divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
        style={{ background: "var(--fill-secondary)" }}
      >
        {secrets === null && (
          <li className="py-3">
            <div className="skeleton h-5 w-2/5 rounded" />
          </li>
        )}
        {secrets?.length === 0 && (
          <li
            className="py-3 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.sandbox.noCredentials}
          </li>
        )}
        {secrets?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <KeyRound size={18} style={{ color: "var(--icon-secondary)" }} />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[16px]"
                style={{ color: "var(--text-primary)" }}
              >
                {s.name}
              </span>
              <span
                className="block truncate text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {where(s.deliver, t)}
              </span>
            </span>
            <button
              className="hover-fade rounded-full px-2 py-1 text-[14px] font-medium"
              style={{ color: "var(--fill-red)" }}
              onClick={() => setRemoving(s)}
            >
              {t.common.remove}
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={removing !== null} onClose={() => setRemoving(null)} bare>
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
            {t.sandbox.removeTitle(removing?.name ?? "")}
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.sandbox.removeHelp}
          </p>
          <button
            disabled={busy}
            className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--fill-red)" }}
            onClick={() => removing && remove(removing)}
          >
            {t.common.remove}
          </button>
          <button
            className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
            style={{ color: "var(--text-primary)" }}
            onClick={() => setRemoving(null)}
          >
            {t.common.cancel}
          </button>
        </div>
      </Sheet>
    </section>
  );
}
