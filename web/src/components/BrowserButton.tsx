/**
 * The browser button, top-right where Muse has its Invite button (remuse has
 * no invites): always there, it opens the browser viewer. Its badge follows
 * the newest run that needs the user, else the newest one in flight: an
 * orange "!" while one waits for you, a pulsing dot while one works, nothing
 * when no browser is busy.
 */
import { Monitor } from "lucide-react";
import type { State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { browserStatus, pillBrowser } from "../view.ts";

export function BrowserButton({ conversation, actions }: { conversation: State; actions: Actions }) {
  const run = pillBrowser(conversation);
  const meta = run ? browserStatus[run.status] : null;
  const waiting = run?.status === "waiting" || run?.status === "needs_you";

  return (
    <button
      aria-label={meta ? `Browser: ${meta.label}` : "Browser"}
      className="absolute right-3 top-2 z-30 flex size-10 items-center justify-center rounded-full"
      style={{ background: "var(--fill-primary)", color: meta?.color ?? "var(--icon-primary)", boxShadow: "var(--shadow-float)" }}
      onClick={() => actions.openViewer(run?.id ?? null)}
    >
      <Monitor size={18} />
      {meta &&
        (waiting ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white"
            style={{ background: "var(--fill-orange)", boxShadow: "0 0 0 2px var(--fill-primary)" }}
          >
            !
          </span>
        ) : (
          <span
            className="absolute right-0 top-0 size-2.5 animate-pulse rounded-full"
            style={{ background: meta.color, boxShadow: "0 0 0 2px var(--fill-primary)" }}
          />
        ))}
    </button>
  );
}
