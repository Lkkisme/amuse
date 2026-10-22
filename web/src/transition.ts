/**
 * A UI change as a view transition, where the browser has them: elements
 * named alike (the Muse avatar, at the top and in its panel) travel from
 * their old place to their new one. Elsewhere the change just happens; on a
 * wider screen the avatar flies over it by itself (flyAvatar).
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

/** Where a Muse avatar is drawn: at the top of the chat, or in its panel (one at a time, but both while it travels). */
export const AVATAR = "data-muse-avatar";
/** What is hidden with an avatar while its copy flies (the top one's shadow and name go with it). */
export const AVATAR_GROUP = "data-muse-avatar-group";

/** The panels' curve (index.css), as a function of time: cubic-bezier(0.2, 0, 0, 1). */
function eased(t: number): number {
  // the curve's x for a parameter, solved for t by bisection (exact enough for a quarter of a second)
  const at = (u: number, a: number, b: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (at(mid, 0.2, 0) < t) low = mid;
    else high = mid;
  }
  return at((low + high) / 2, 0, 1);
}

/**
 * A change in which the Muse avatar flies from its place to its new one, on a wider screen (on a phone, `transition`
 * does it). The panels move as they always do; a copy of the avatar crosses over them, following where the new one is
 * at each moment (it rides a panel that slides, or a chat that is pushed aside), so it lands on it exactly.
 */
export function flyAvatar(change: () => void): void {
  const from = document.querySelector<HTMLElement>(`[${AVATAR}]`);
  const start = from?.getBoundingClientRect();
  flushSync(change);
  if (!from || !start || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const to = [...document.querySelectorAll<HTMLElement>(`[${AVATAR}]`)].find((el) => el !== from);
  if (!to) return;
  const copy = to.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  copy.removeAttribute(AVATAR);
  copy.setAttribute("aria-hidden", "true");
  const fontFrom = parseFloat(getComputedStyle(from).fontSize);
  const fontTo = parseFloat(getComputedStyle(to).fontSize);
  // where it starts, before it is shown at all
  Object.assign(copy.style, {
    position: "fixed",
    margin: "0",
    zIndex: "100",
    pointerEvents: "none",
    boxShadow: "var(--shadow-float)",
    left: `${start.left}px`,
    top: `${start.top}px`,
    width: `${start.width}px`,
    height: `${start.height}px`,
    fontSize: `${fontFrom}px`,
  });
  document.body.append(copy);
  const ends = [from, to].map((el) => el.closest<HTMLElement>(`[${AVATAR_GROUP}]`) ?? el);
  for (const el of ends) el.style.visibility = "hidden";
  const began = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / 240);
    const k = eased(t);
    const end = to.getBoundingClientRect();
    const mix = (a: number, b: number) => a + (b - a) * k;
    Object.assign(copy.style, {
      left: `${mix(start.left, end.left)}px`,
      top: `${mix(start.top, end.top)}px`,
      width: `${mix(start.width, end.width)}px`,
      height: `${mix(start.height, end.height)}px`,
      fontSize: `${mix(fontFrom, fontTo)}px`,
    });
    if (t < 1) return void requestAnimationFrame(step);
    copy.remove();
    for (const el of ends) el.style.visibility = "";
  };
  requestAnimationFrame(step);
}
