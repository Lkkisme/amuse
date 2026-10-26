/**
 * Shared sheet shell: bottom drawer on mobile (slides up, slides back down),
 * centered card on sm+ (scale in/out). Its close button is the app's round
 * one (bar.ts), concentric with the corner: 6px inset + 22px radius = 28px.
 * Backdrop and close X are part of the shell; it stays mounted while the exit
 * animation plays. On a phone a finger pulls it down to close it (sheetDrag.ts).
 */
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePresence } from "./usePresence";
import { barButton, barButtonLook, barIcon } from "./bar";
import { useT } from "../i18n/react.ts";
import { claim, closes } from "../sheetDrag.ts";

/** Where the sheet is a drawer from the bottom (below Tailwind's sm). */
const DRAWER = "(max-width: 639px)";
/** The snap back, on the curve of a swipe settling (index.css `.swipe-settle`). */
const BACK = "translate 0.24s cubic-bezier(0.2, 0, 0, 1)";
/** How far back (ms) the finger's speed is taken. */
const RECENT = 100;

/**
 * `bare`: no close button (the content has its own Cancel), and a handle on top on a phone, as Muse's input sheets.
 * `wide`: room for reading (a task's steps and request), not a form's width.
 */
export function Sheet({
  open,
  onClose,
  children,
  bare = false,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  bare?: boolean;
  wide?: boolean;
}) {
  const t = useT();
  const { mounted, closing, onAnimationEnd } = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // its own `translate`, not `transform`, which the sheet's animations hold; the exit animation then goes on from where the finger let go
    let from: { x: number; y: number; id: number } | null = null;
    let state: "wait" | "pull" | "other" = "other";
    /** the finger's recent places, for its speed on lifting */
    let trail: { y: number; time: number }[] = [];
    const onStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      from = null;
      if (event.touches.length !== 1 || !touch || !matchMedia(DRAWER).matches || scrolledUnder(event.target, el)) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      from = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
      state = "wait";
      trail = [{ y: touch.clientY, time: event.timeStamp }];
    };
    const onMove = (event: TouchEvent) => {
      const touch = [...event.changedTouches].find((t) => t.identifier === from?.id);
      if (!from || !touch || state === "other") return;
      if (state === "wait") state = claim(touch.clientX - from.x, touch.clientY - from.y);
      if (state !== "pull") return;
      if (event.cancelable) event.preventDefault(); // the sheet moves, not the page under it
      trail = [...trail.filter((at) => event.timeStamp - at.time < RECENT), { y: touch.clientY, time: event.timeStamp }];
      el.style.transition = "none";
      el.style.translate = `0 ${Math.max(0, touch.clientY - from.y)}px`;
    };
    const onEnd = (event: TouchEvent) => {
      const touch = [...event.changedTouches].find((t) => t.identifier === from?.id);
      if (!from || !touch) return;
      const dy = touch.clientY - from.y;
      const pulled = state === "pull";
      from = null;
      state = "other";
      if (!pulled) return;
      const since = trail.find((at) => event.timeStamp - at.time < RECENT);
      const speed = since && event.timeStamp > since.time ? (touch.clientY - since.y) / (event.timeStamp - since.time) : 0;
      if (event.type === "touchend" && closes(dy, speed, el.offsetHeight)) close.current();
      else {
        el.style.transition = BACK;
        el.style.translate = "";
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [mounted]);
  // opened again (or kept open) after a pull: back in place
  useEffect(() => {
    if (open && panel.current) panel.current.style.translate = "";
  }, [open]);
  if (!mounted) return null;
  // at the top of the page: inside another layer (settings, which animates and clips) a fixed sheet would be held to it
  return createPortal(
    <div
      data-no-swipe=""
      className={`fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4 ${closing ? "pointer-events-none" : ""}`}
    >
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/50`}
        onClick={onClose}
      />
      {/* 92% of this full-height layer is the same height in a browser, where 92vh is the large viewport;
          the app's WebView reports 0 for the height viewport units, which would collapse the sheet. */}
      <div
        ref={panel}
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-modal-out" : "anim-modal-in"} relative flex max-h-[max(92vh,92%)] w-full ${wide ? "max-w-xl" : "max-w-sm"} flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]`}
        style={{
          background: "var(--chat-background)",
          boxShadow: "var(--shadow-sheet)",
        }}
      >
        {bare ? (
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full sm:hidden"
            style={{ background: "var(--fill-tertiary)" }}
          />
        ) : (
          <button
            aria-label={t.common.close}
            className={`${barButton} absolute right-1.5 top-1.5 z-10`}
            style={barButtonLook}
            onClick={onClose}
          >
            <X size={barIcon} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Whether something between the finger and the sheet has scrolled down: the finger scrolls it back up first. */
function scrolledUnder(target: EventTarget | null, sheet: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== sheet; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
}
