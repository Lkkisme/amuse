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

/** The tight corner where items join. */
const JOINED = 6;

/** Corner radii for an item of `round` corners at `place` on `side`. */
export function corners(side: Side, place: Place, round = 22): CSSProperties {
  const top = place.joinsPrevious ? JOINED : round;
  const bottom = place.joinsNext ? JOINED : round;
  return side === "user"
    ? { borderRadius: `${round}px ${top}px ${bottom}px ${round}px` }
    : { borderRadius: `${top}px ${round}px ${round}px ${bottom}px` };
}
