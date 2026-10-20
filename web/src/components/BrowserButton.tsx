/**
 * The browser button, top-right where Muse has its Invite button (remuse has
 * no invites): always there, it opens the browser viewer. Open, the viewer
 * carries it in its own top-right corner (where a close button would be) as
 * its collapse button: one button, travelling there and back (a view
 * transition). Its badge follows the newest run that needs the user, else the
 * newest one in flight: an orange "!" while one waits for you, a pulsing dot
 * while one works.
 */
import { Monitor, PanelRightClose } from "lucide-react";
import type { State } from "@remuse/protocol";
import { browserButton } from "../transition.ts";
import type { Actions } from "../ui.ts";
import { browserStatus, pillBrowser } from "../view.ts";

const round = "flex size-10 shrink-0 items-center justify-center rounded-full";
const look = { background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" };

export function BrowserButton({ conversation, actions }: { conversation: State; actions: Actions }) {
  const run = pillBrowser(conversation);
  const meta = run ? browserStatus[run.status] : null;
  const waiting = run?.status === "waiting" || run?.status === "needs_you";

  return (
    <button
      aria-label={meta ? `Browser: ${meta.label}` : "Browser"}
      className={`${round} absolute right-3 top-2 z-30`}
      style={{ ...look, ...browserButton, color: meta?.color ?? "var(--icon-primary)" }}
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

/**
 * The same button, open: in the viewer's corner, it collapses the viewer. While the viewer
 * plays its way out (`leaving`), the button is already back in the chat, so this one lets go of the name.
 */
export function CollapseBrowser({ leaving, actions }: { leaving: boolean; actions: Actions }) {
  return (
    <button
      aria-label="Close browser"
      className={round}
      style={{ ...look, ...(leaving ? {} : browserButton), color: "var(--icon-primary)" }}
      onClick={() => actions.closeViewer()}
    >
      <PanelRightClose size={18} />
    </button>
  );
}
