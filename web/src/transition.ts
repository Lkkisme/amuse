/**
 * A UI change as a view transition, where the browser has them: elements
 * named alike (the Muse avatar, at the top and in its panel) travel from
 * their old place to their new one. Elsewhere the change just happens.
 */
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";

/** Whether changes travel (view transitions); where they do, what travels must not also animate on its own. */
export const travels = (): boolean => "startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches;

export function transition(change: () => void): void {
  if (!travels()) return change();
  document.startViewTransition(() => flushSync(change));
}

/** The name the Muse avatar travels under (one element at a time may carry it). */
export const museAvatar: CSSProperties = { viewTransitionName: "muse-avatar" };
