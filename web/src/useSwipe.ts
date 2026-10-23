/**
 * Fingers on the phone's chat, read as swipes that open and close the sidebar and the viewer (swipe.ts has the
 * rules). Touch events on the document: a finger is watched from its first touch, and only once the movement is
 * clearly sideways is the browser's own handling (scrolling) stopped, never before. The page then follows the
 * finger, by `--swipe` (how open it is, 0 to 1) on its elements, without a render per move; on lifting it settles on
 * the curve of the buttons (index.css), and the change is made to the UI state once it has.
 *
 * Off: where the pointer is not coarse or the window is not a phone's; while something is over the chat (a sheet,
 * a menu: `blocked`, `data-no-swipe`); when the touch starts in a text field, or while text is selected (the page's,
 * or the terminal's: `data-selecting`); and for sideways content that can still scroll the way the finger goes.
 * Anywhere else a swipe closes the viewer, a live desktop that is only watched included: noVNC sends nothing from
 * a view-only desktop. Only while the user controls the desktop (`data-no-swipe` on it) does it keep every touch.
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
    /** where the finger's moves and lifting are heard: the node it touched, which hears them even once it has been
     * replaced (the terminal redraws its rows), when they no longer bubble up to the document */
    let node: Element | null = null;
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
      if (event.touches.length !== 1 || !touch) return; // a second finger does not count
      if (finger !== null) {
        // the first one is gone, its lifting unheard: let go of it
        finger = null;
        release();
        feed({ kind: "cancel" }, event);
      }
      if (settling !== undefined) return;
      if (latest.current.blocked || !eligible(event.target)) return;
      finger = touch.identifier;
      node = event.target instanceof Element ? event.target : null;
      node?.addEventListener("touchmove", heardMove, { passive: false }); // cancelled once the swipe is claimed
      node?.addEventListener("touchend", heardEnd);
      node?.addEventListener("touchcancel", heardEnd);
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
    const release = () => {
      node?.removeEventListener("touchmove", heardMove);
      node?.removeEventListener("touchend", heardEnd);
      node?.removeEventListener("touchcancel", heardEnd);
      node = null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = mine(event);
      if (touch) feed({ kind: "move", at: { x: touch.clientX, y: touch.clientY }, time: event.timeStamp }, event);
    };
    const onEnd = (event: TouchEvent) => {
      if (!mine(event)) return;
      finger = null;
      release();
      feed(event.type === "touchcancel" ? { kind: "cancel" } : { kind: "up", time: event.timeStamp }, event);
    };

    // (an element's listeners are typed by the plain Event; only touches reach these)
    const heard = (handler: (event: TouchEvent) => void) => (event: Event) => {
      if (event instanceof TouchEvent) handler(event);
    };
    const heardMove = heard(onMove);
    const heardEnd = heard(onEnd);

    // in the capture phase: noVNC stops the touches on its canvas before they could bubble up to the document
    document.addEventListener("touchstart", onStart, { passive: true, capture: true });
    return () => {
      clearTimeout(settling);
      release();
      document.removeEventListener("touchstart", onStart, { capture: true });
    };
  }, []);

  return swipe;
}

/** Whether a touch that starts on `target` may be a swipe, as far as the page can tell before it moves. */
function eligible(target: EventTarget | null): boolean {
  if (!matchMedia(PHONE).matches || !(target instanceof Element)) return false;
  // what keeps its touches (the sheets; the live desktop while the user controls it; the terminal while text is
  // selected in it) is marked; a text field's fingers are for its text
  const own = "[data-no-swipe], [data-selecting], input, textarea, select, [contenteditable]:not([contenteditable=false])";
  if (target.closest(own) || document.querySelector("[role=menu]")) return false;
  return !selecting();
}

/** Whether text is selected, on the page or in a field (a swipe would drag its handles about). */
function selecting(): boolean {
  const field = document.activeElement;
  // the terminal's own field holds what is selected in it, even after the selection is gone: TerminalView says when it is
  if (field?.closest(".xterm")) return false;
  if (getSelection()?.isCollapsed === false) return true;
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
