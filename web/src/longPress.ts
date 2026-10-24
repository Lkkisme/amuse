/**
 * A long press on a phone, for the menu on Amuse's messages and cards (Reply, Copy). It is a finger held still on the
 * item for `HOLD` ms, and nothing else: a finger that travels `SLOP` px is a scroll or a swipe (the sidebar's and the
 * viewer's, useSwipe), one that lifts is a tap, and a second finger or the browser taking the touch over (pointercancel)
 * ends it. Mouse and keyboard never press: with a pointer there are the hover actions.
 */
import { useEffect, useRef } from "react";

/** How long (ms) a finger stays still on an item before it is a long press. */
export const HOLD = 450;
/** Travel (px) under which a finger counts as still. */
export const SLOP = 8;
/** How long (ms) after a long press fired the browser's own menu for it is still held back. */
const AFTER = 600;

/** Whether a finger that went down at `from` has moved too far to be holding still at `to`. */
/** Only a finger presses: a mouse (and a pen) never does, so dragging across messages selects their words as it always did. */
export const presses = (pointerType: string, isPrimary: boolean): boolean => pointerType === "touch" && isPrimary;

export const drifted = (from: { x: number; y: number }, to: { x: number; y: number }): boolean => Math.hypot(to.x - from.x, to.y - from.y) > SLOP;

/** What a press is not for: links, buttons and fields have their own touch. */
const OWN = "a, button, input, textarea, select, summary, img, video, [role='slider']";

type Press = { point: { x: number; y: number }; timer: ReturnType<typeof setTimeout> };

/**
 * Pointer `handlers` for an item that opens something on a long press: `fire` gets where the finger is and the item.
 */
export function useLongPress(fire: (point: { x: number; y: number }, item: HTMLElement) => void) {
  const press = useRef<Press | null>(null);
  const firedAt = useRef(0);
  const latest = useRef(fire);
  latest.current = fire;
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancel, []);
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      cancel();
      if (!presses(e.pointerType, e.isPrimary)) return;
      if (e.target instanceof Element && e.target.closest(OWN)) return;
      const item = e.currentTarget;
      const point = { x: e.clientX, y: e.clientY };
      const timer = setTimeout(() => {
        press.current = null;
        // words the phone has already selected are the phone's
        if (getSelection()?.isCollapsed === false) return;
        firedAt.current = Date.now();
        latest.current(point, item);
      }, HOLD);
      press.current = { point, timer };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (press.current && drifted(press.current.point, { x: e.clientX, y: e.clientY })) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // the phone's own menu for a held press would come up over this one
    onContextMenu: (e: React.MouseEvent) => {
      if (Date.now() - firedAt.current < AFTER || press.current) e.preventDefault();
    },
  };
  return { handlers };
}
