/**
 * A phone's sheet pulled down by the finger (Sheet.tsx): the rules, apart from the touches.
 * A finger that goes down before it goes sideways takes the sheet with it, unless what it touched can still scroll
 * up; on lifting, the sheet goes if it was pulled far or flicked, and comes back otherwise.
 */

/** How far (px) a finger moves before it is read as a pull or as something else. */
export const SLOP = 8;
/** The part of the sheet's height a pull must cover to close it. */
const FAR = 0.25;
/** A flick (px/ms) closes it however short. */
const FLICK = 0.5;

/** What a finger that has moved by dx, dy (down is positive) is doing: not yet clear, pulling the sheet, or something else (scrolling, a sideways move). */
export function claim(dx: number, dy: number): "wait" | "pull" | "other" {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return "wait";
  return dy > 0 && dy > Math.abs(dx) ? "pull" : "other";
}

/** Whether a sheet of `height`, let go of `dy` down, at `speed` px/ms (down is positive), closes. */
export function closes(dy: number, speed: number, height: number): boolean {
  return dy > height * FAR || (dy > SLOP && speed > FLICK);
}
