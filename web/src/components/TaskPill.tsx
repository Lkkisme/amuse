/**
 * Browser task indicator, top-right where Muse has its Invite button (remuse
 * has no invites; owner's call). Collapsed: a round monitor button with a badge,
 * orange "!" while the run waits for you, a pulsing blue dot while it works.
 * Tap expands a small card below it: status, task, Open and Stop task.
 * Follows the newest run that needs the user, else the newest one in flight.
 */
import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import type { State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { browserStatus, pillBrowser } from "../view.ts";

export function TaskPill({ conversation, actions }: { conversation: State; actions: Actions }) {
  const run = pillBrowser(conversation);
  // closed -> open -> closing (exit animation) -> closed
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const open = phase === "open";
  const close = () => setPhase((p) => (p === "open" ? "closing" : p));
  const rootRef = useRef<HTMLDivElement>(null);

  // collapse on any tap outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!run) return null;
  const meta = browserStatus[run.status];
  const waiting = run.status === "waiting" || run.status === "needs_you";

  return (
    <div ref={rootRef} className="absolute right-3 top-2 z-30">
      <button
        aria-label={`Browser: ${meta.label}`}
        aria-expanded={open}
        className="anim-fade-in relative flex size-10 items-center justify-center rounded-full"
        style={{ background: "var(--fill-primary)", color: meta.color, boxShadow: "var(--shadow-float)" }}
        onClick={() => (open ? close() : setPhase("open"))}
      >
        <Monitor size={18} />
        {waiting ? (
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
        )}
      </button>

      {phase !== "closed" && (
        <div
          className={`${open ? "anim-popover-in" : "anim-popover-out"} absolute right-0 top-12 w-64 rounded-2xl p-3`}
          onAnimationEnd={() => setPhase((p) => (p === "closing" ? "closed" : p))}
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-raised)" }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: `color-mix(in srgb, ${meta.color} 12%, var(--fill-primary))`, color: meta.color }}
            >
              <Monitor size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                Browser
              </p>
              <p className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {meta.label} · {run.title}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="h-9 flex-1 rounded-full text-[14px] font-medium text-white"
              style={{ background: "var(--fill-blue)" }}
              onClick={() => {
                close();
                actions.openViewer(run.id);
              }}
            >
              Open
            </button>
            <button
              className="hover-fade h-9 flex-1 rounded-full text-[14px] font-medium"
              style={{ background: "var(--fill-secondary)", color: "var(--fill-red)" }}
              onClick={() => {
                close();
                actions.control(run.id, "stop");
              }}
            >
              Stop task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
