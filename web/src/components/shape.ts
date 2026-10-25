/**
 * The shape of everything in the chat feed, bubbles and cards alike. An item
 * sits on its sender's side (the user's on the right, Muse's on the left);
 * where it joins the item above or below it from the same side, its corners
 * on that side tighten, so a group reads as one column (Muse). The feed works
 * out each item's place; nothing draws its own outer corners.
 */
import type { CSSProperties } from "react";

export type Side = "user" | "muse";

/** Whether the item joins the one above it and the one below it. */
export type Place = { joinsPrevious: boolean; joinsNext: boolean };

export const alone: Place = { joinsPrevious: false, joinsNext: false };

/** A chat bubble's corner, half of a one-line bubble's height (22px line + 2 × 13px), so one line is a full pill; and the side padding. */
export const BUBBLE = 24;
export const BUBBLE_PAD = 16;

/** The tight corner where items join. */
const JOINED = 6;

/** A box inside an item, `inset` from its edge: concentric with the item's corner of radius `outer`, never negative. */
export const concentric = (outer: number, inset: number): number => Math.max(0, outer - inset);

/** The radius of the item's corners at the bottom (a bubble's 22px, or the tight one when it joins the item below). */
export const bottomRound = (place: Place, round = 22): number => (place.joinsNext ? JOINED : round);

/** Corner radii for an item of `round` corners at `place` on `side`. */
export function corners(side: Side, place: Place, round = 22): CSSProperties {
  const top = place.joinsPrevious ? JOINED : round;
  const bottom = place.joinsNext ? JOINED : round;
  return side === "user"
    ? { borderRadius: `${round}px ${top}px ${bottom}px ${round}px` }
    : { borderRadius: `${top}px ${round}px ${round}px ${bottom}px` };
}
