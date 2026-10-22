/**
 * A UI change as a view transition, where the browser has them: elements
 * named alike (the Muse avatar, at the top and in its panel) travel from
 * their old place to their new one. Elsewhere the change just happens.
 */
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";

/**
 * Whether changes travel (view transitions); where they do, what travels must not also animate on its own.
 * Only on a phone, where the Muse panel is a page: on a wider screen the panels push the chat aside, and a
 * transition's snapshots would cross-fade the chat instead of moving it.
 */
export const travels = (): boolean =>
  "startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches && matchMedia("(max-width: 767px)").matches;

export function transition(change: () => void): void {
  if (!travels()) return change();
  document.startViewTransition(() => flushSync(change));
}

/** The name the Muse avatar travels under (one element at a time may carry it). */
export const museAvatar: CSSProperties = { viewTransitionName: "muse-avatar" };
