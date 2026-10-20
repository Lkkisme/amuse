/**
 * A UI change as a view transition, where the browser has them: elements
 * named alike (the Muse avatar, at the top and in its panel) travel from
 * their old place to their new one. Elsewhere the change just happens.
 */
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";

export function transition(change: () => void): void {
  if (!("startViewTransition" in document) || matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  document.startViewTransition(() => flushSync(change));
}

/** The name the Muse avatar travels under (one element at a time may carry it). */
export const museAvatar: CSSProperties = { viewTransitionName: "muse-avatar" };

/** The browser button travels between the chat's corner (closed) and the viewer's (open, as its collapse button). */
export const browserButton: CSSProperties = { viewTransitionName: "browser-button" };
