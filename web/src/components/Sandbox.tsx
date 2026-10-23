/**
 * Settings › Sandbox: Amuse's own machine, where it runs programs and keeps
 * what it installs. Resetting stops what runs in it and wipes its home folder;
 * the workspace (the files shared with the user) is kept, and so is what was
 * installed system-wide, until the container is recreated on the server (see
 * the README). The credentials it uses live in the Vault, which a row here leads to.
 */
import { useState } from "react";
import { ChevronRight, KeyRound, Terminal } from "lucide-react";
import type { Session } from "@amuse/protocol";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
import { useT } from "../i18n/react.ts";

export function Sandbox({ session, onSecrets }: { session: Session; onSecrets: () => void }) {
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
          <Button
            onCard
            tone="danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t.common.reset}
          </Button>
        </li>
      </ul>

      <ul
        className="mt-3 divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
        style={{ background: "var(--fill-secondary)" }}
      >
        <li>
          <button className="flex w-full items-center gap-3 py-2.5 text-left" onClick={onSecrets}>
            <KeyRound size={18} style={{ color: "var(--icon-secondary)" }} />
            <span
              className="min-w-0 flex-1 text-[16px]"
              style={{ color: "var(--text-primary)" }}
            >
              {t.sandbox.secretsRow}
            </span>
            <ChevronRight size={16} style={{ color: "var(--icon-secondary)" }} />
          </button>
        </li>
      </ul>

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={Terminal}
        title={t.sandbox.resetTitle}
        body={t.sandbox.resetHelp}
        action={t.common.reset}
        busy={busy}
        onConfirm={reset}
      />
    </div>
  );
}
