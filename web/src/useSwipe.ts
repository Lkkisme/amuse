/**
 * Fingers on the phone's chat, read as swipes that open and close the sidebar and the Amuse panel (swipe.ts has the
 * rules). Touch events on the document: a finger is watched from its first touch, and only once the movement is
 * clearly sideways is the browser's own handling (scrolling) stopped, never before. The page then follows the
 * finger, by `--swipe` (how open it is, 0 to 1) on its elements, without a render per move; on lifting it settles on
 * the curve of the buttons (index.css), and the change is made to the UI state once it has.
 *
 * Off: where the pointer is not coarse or the window is not a phone's; while something is over the chat (the
 * viewer, a sheet, a menu: `blocked`, `data-no-swipe`); when the touch starts in a text field, or while text is
 * selected; and for sideways content that can still scroll the way the finger goes.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type Input, type Panel, type Scrolls, initial, step } from "./swipe.ts";

/** What a swipe is doing to its page; null: nothing. */
export type Swipe = {
  panel: Panel;
  /**
   * drag: it follows the finger. settle: it is going where the finger let go. rest: it was opened by a swipe and
   * stays (without the animation a button would play) until it closes. closed: it was swiped away; it goes at once.
   */
  phase: "drag" | "settle" | "rest" | "closed";
};

/** The duration (ms) of the buttons' slide, which a page settling takes too (index.css `.swipe-settle`). */
const SETTLE = 240;
/** A phone, with a finger. */
const PHONE = "(pointer: coarse) and (max-width: 767px)";
/** The width (px) of each screen edge a browser's own back gesture takes; the installed app has no such gesture on iOS. */
const SYSTEM_EDGE = 20;

interface Options {
  /** the page that is open (the top one), if any */
  open: Panel | null;
  /** something is over the chat that has gestures of its own, or none should be made */
  blocked: boolean;
  /** make the page open or closed in the UI state */
  commit: (panel: Panel, open: boolean) => void;
}

export function useSwipe({ open, blocked, commit }: Options): Swipe | null {
  const [swipe, setSwipe] = useState<Swipe | null>(null);
  const latest = useRef({ open, blocked, commit });
  latest.current = { open, blocked, commit };

  // a page swiped open stays still until it closes some other way; one swiped away is gone
  useEffect(() => {
    if (swipe?.phase === "closed" || (swipe?.phase === "rest" && open !== swipe.panel)) setSwipe(null);
  }, [swipe, open]);

  useEffect(() => {
    let state = initial;
    let finger: number | null = null;
    let settling: ReturnType<typeof setTimeout> | undefined;

    const show = (panel: Panel, progress: number) => {
      for (const el of document.querySelectorAll<HTMLElement>(`[data-swipe="${panel}"]`)) el.style.setProperty("--swipe", String(progress));
    };
    const settle = (panel: Panel, to: boolean) => {
      flushSync(() => setSwipe({ panel, phase: "settle" }));
      for (const el of document.querySelectorAll(`[data-swipe="${panel}"]`)) el.getBoundingClientRect(); // it goes from where the finger left it
      show(panel, to ? 1 : 0);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      settling = setTimeout(
        () => {
          settling = undefined;
          latest.current.commit(panel, to);
          setSwipe({ panel, phase: to ? "rest" : "closed" });
        },
        reduced ? 0 : SETTLE + 20,
      );
    };

    const feed = (input: Input, event: TouchEvent) => {
      const [next, outputs] = step(state, input);
      state = next;
      for (const output of outputs) {
        if (output.kind === "begin") {
          flushSync(() => setSwipe({ panel: output.panel, phase: "drag" }));
          show(output.panel, output.progress);
        } else if (output.kind === "drag") show(output.panel, output.progress);
        else settle(output.panel, output.open);
      }
      // the swipe is ours from its first claimed move: the page must not scroll or pan under it
      if (next.phase.kind === "dragging" && event.cancelable) event.preventDefault();
    };
    const mine = (event: TouchEvent) => [...event.changedTouches].find((t) => t.identifier === finger);

    const onStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (finger !== null || settling !== undefined || event.touches.length !== 1 || !touch) return;
      if (latest.current.blocked || !eligible(event.target)) return;
      finger = touch.identifier;
      feed(
        {
          kind: "down",
          at: { x: touch.clientX, y: touch.clientY },
          time: event.timeStamp,
          width: document.documentElement.clientWidth,
          open: latest.current.open,
          inset: matchMedia("(display-mode: standalone)").matches ? 0 : SYSTEM_EDGE,
          scrolls: scrollsUnder(event.target),
        },
        event,
      );
    };
    const onMove = (event: TouchEvent) => {
      const touch = mine(event);
      if (touch) feed({ kind: "move", at: { x: touch.clientX, y: touch.clientY }, time: event.timeStamp }, event);
    };
    const onEnd = (event: TouchEvent) => {
      if (!mine(event)) return;
      finger = null;
      feed(event.type === "touchcancel" ? { kind: "cancel" } : { kind: "up", time: event.timeStamp }, event);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false }); // cancelled once the swipe is claimed
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      clearTimeout(settling);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return swipe;
}

/** Whether a touch that starts on `target` may be a swipe, as far as the page can tell before it moves. */
function eligible(target: EventTarget | null): boolean {
  if (!matchMedia(PHONE).matches || !(target instanceof Element)) return false;
  // the viewer's desktop and terminal and the sheets have gestures of their own; a text field's fingers are for its text
  const own = "[data-no-swipe], input, textarea, select, [contenteditable]:not([contenteditable=false])";
  if (target.closest(own) || document.querySelector("[role=menu]")) return false;
  return !selecting();
}

/** Whether text is selected, on the page or in a field (a swipe would drag its handles about). */
function selecting(): boolean {
  if (getSelection()?.isCollapsed === false) return true;
  const field = document.activeElement;
  return (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.selectionStart !== field.selectionEnd;
}

/** Whether something under the finger, from `target` up, still scrolls sideways: a finger going left needs room to its right, and the other way round. */
function scrollsUnder(target: EventTarget | null): Scrolls {
  const scrolls: Scrolls = { left: false, right: false };
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const overflow = getComputedStyle(el).overflowX;
    if (overflow !== "auto" && overflow !== "scroll" && !(el instanceof HTMLInputElement)) continue;
    if (el.scrollLeft > 0) scrolls.right = true;
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) scrolls.left = true;
  }
  return scrolls;
}
