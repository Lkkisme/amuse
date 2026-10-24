/**
 * Settings › Computer: Amuse's own machine, where it installs software and runs
 * programs. Resetting stops what runs in it and wipes its home folder; the
 * workspace (the files shared with the user) is kept, and so is what was
 * installed system-wide, until the container is recreated on the server (see
 * the README). Before the reset goes ahead, the confirmation names the folders
 * in its home that would go with it, so anything kept there can be moved into
 * the user's files first.
 */
import { useState } from "react";
import { Terminal } from "lucide-react";
import type { AtRiskFolder, Session } from "@amuse/protocol";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
import { useT } from "../i18n/react.ts";
import { computerName } from "../secrets.ts";

export function Sandbox({ session }: { session: Session }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [atRisk, setAtRisk] = useState<AtRiskFolder[]>([]);

  /** Ask what a reset would delete, and open the confirmation: a scan that cannot be made leaves the words alone. */
  const ask = () => {
    setConfirming(true);
    setAtRisk([]);
    session.call("sandbox.atRisk", {}).then(
      (answer) => setAtRisk(answer.folders),
      () => setAtRisk([]),
    );
  };

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
        {t.sandbox.description(computerName(t))}
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
            onClick={ask}
          >
            {t.common.reset}
          </Button>
        </li>
      </ul>

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={Terminal}
        title={t.sandbox.resetTitle(computerName(t))}
        body={t.sandbox.resetHelp}
        action={t.common.reset}
        busy={busy}
        onConfirm={reset}
      >
        {atRisk.length > 0 && (
          <div
            className="mt-3 w-full rounded-[14px] px-3.5 py-3 text-left"
            style={{ background: "var(--fill-secondary)" }}
          >
            <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {t.sandbox.resetDeletes}
            </p>
            <ul className="mt-1">
              {atRisk.map((folder) => (
                <li
                  key={folder.path}
                  className="break-all text-[14px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {folder.repository
                    ? t.sandbox.resetRepository(folder.path)
                    : t.sandbox.resetFolder(folder.path)}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {t.sandbox.resetAskToMove}
            </p>
          </div>
        )}
      </ConfirmSheet>
    </div>
  );
}
