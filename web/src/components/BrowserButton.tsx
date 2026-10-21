/**
 * The browser button, top-right where Muse has its Invite button (amuse has
 * no invites). Like the menu button, it never moves: it opens the browser
 * viewer and, while the viewer is open, morphs in place into the button that
 * collapses it, staying above the viewer (whose header leaves it the corner).
 * Its badge follows the newest run that needs the user, else the newest one
 * in flight: an orange "!" while one waits for you, a pulsing dot while one works.
 */
import { Monitor, PanelRightClose, X } from "lucide-react";
import type { State } from "@amuse/protocol";
import type { Actions } from "../ui.ts";
import { browserLook, pillBrowser } from "../view.ts";

export function BrowserButton({ conversation, open, actions }: { conversation: State; open: boolean; actions: Actions }) {
  const run = pillBrowser(conversation);
  const meta = run && !open ? browserLook(run) : null;
  const waiting = run?.status === "waiting" || run?.status === "needs_you";
  const icon = "absolute transition-all duration-200 ease-out";

  return (
    <button
      aria-label={open ? "Close browser" : meta ? `Browser: ${meta.label}` : "Browser"}
      aria-expanded={open}
      // open, it is held to the window's corner (the viewer's), where it already is unless a docked Muse panel was beside it
      className={`${open ? "fixed z-[60]" : "absolute z-30"} right-3 top-3 flex size-11 items-center justify-center rounded-full`}
      style={{ background: "var(--fill-primary)", color: meta?.color ?? "var(--icon-primary)", boxShadow: "var(--shadow-float)" }}
      onClick={() => (open ? actions.closeViewer() : actions.openViewer(run?.id ?? null))}
    >
      <Monitor size={20} className={icon} style={{ opacity: open ? 0 : 1, transform: open ? "rotate(90deg) scale(0.6)" : "none" }} />
      {/* the viewer is a side panel from lg up (collapse it), a full screen below (close it) */}
      <PanelRightClose size={20} className={`${icon} hidden lg:block`} style={{ opacity: open ? 1 : 0, transform: open ? "none" : "rotate(-90deg) scale(0.6)" }} />
      <X size={20} className={`${icon} lg:hidden`} style={{ opacity: open ? 1 : 0, transform: open ? "none" : "rotate(-90deg) scale(0.6)" }} />
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
