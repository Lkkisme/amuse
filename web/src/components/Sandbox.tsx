/**
 * Settings › Sandbox: Amuse's own machine, where it runs programs and keeps
 * what it installs. Resetting wipes its home folder back to a fresh one and
 * stops what runs in it; the workspace (the files shared with the user) is
 * kept. A full reset to a fresh image is done on the server (see the README).
 */
import { useState } from "react";
import { Terminal } from "lucide-react";
import type { Session } from "@amuse/protocol";
import { Sheet } from "./Sheet";

export function Sandbox({ session }: { session: Session }) {
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
        Amuse has a computer of its own, where it runs programs and installs
        what it needs. Your files in the workspace are shared with it. Reset it
        to wipe its home folder back to a fresh one and stop what runs there;
        your files are kept.
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
          The sandbox is reset.
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
            Reset the sandbox
          </span>
          <button
            disabled={busy}
            className="hover-fade rounded-full px-2 py-1 text-[14px] font-medium disabled:opacity-50"
            style={{ color: "var(--fill-red)" }}
            onClick={() => setConfirming(true)}
          >
            Reset
          </button>
        </li>
      </ul>

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
            Reset the sandbox?
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            What runs there is stopped, and what Amuse installed or saved in its
            home folder is erased. Your files in the workspace are kept.
          </p>
          <button
            disabled={busy}
            className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--fill-red)" }}
            onClick={reset}
          >
            Reset
          </button>
          <button
            className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
            style={{ color: "var(--text-primary)" }}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      </Sheet>
    </div>
  );
}
