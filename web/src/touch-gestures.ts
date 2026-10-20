/**
 * What fingers on the live desktop mean, as a pure step function: finger
 * events in, mouse and scroll actions out. The same gestures in every mode,
 * as on a phone:
 *
 *   tap               click (where the finger is; in trackpad mode, at the cursor)
 *   one finger slides scroll the page (trackpad: move the cursor; actual size: move the view)
 *   two fingers slide scroll the page
 *   hold, then move   drag with the button down (select text, move a slider)
 *
 * A finger held still for HOLD ms arms the drag: the caller's timer sends
 * `held`, and the output says so, so the screen can show it. All points are
 * client (CSS px) coordinates.
 */

export type Point = { x: number; y: number };
export type Bounds = { left: number; top: number; right: number; bottom: number };

/** touch: the desktop is the page; trackpad: it is a touchpad; pan: actual size, one finger moves the view */
export type Mode = "touch" | "trackpad" | "pan";

/** How long a finger stays still (ms) before a move drags. */
export const HOLD = 450;
/** Travel (px) under which a finger counts as still. */
export const SLOP = 8;
/** Trackpad: finger travel → cursor travel. */
export const TRACKPAD_SPEED = 1.5;

export type Input =
  | { kind: "down"; id: number; at: Point }
  | { kind: "move"; id: number; at: Point }
  | { kind: "up"; id: number }
  /** the hold timer ran out with the finger still down */
  | { kind: "held" };

export type Output =
  /** move the pointer there, with the button down or not */
  | { kind: "point"; at: Point; down: boolean }
  | { kind: "press"; at: Point }
  | { kind: "release"; at: Point }
  /** scroll the page under `at` by the fingers' travel */
  | { kind: "scroll"; at: Point; by: Point }
  /** move the view by the finger's travel */
  | { kind: "pan"; by: Point }
  /** what to show under the finger: holding (the drag arms at HOLD), armed (moves drag), or nothing */
  | { kind: "hint"; hint: Hint };

export type Hint = { kind: "none" } | { kind: "holding"; at: Point } | { kind: "armed"; at: Point };

type Phase =
  | { kind: "idle" }
  /** one finger down, not yet a tap, a slide or a hold */
  | { kind: "pending"; travel: number }
  | { kind: "sliding" }
  /** held, then the button went down: moves drag */
  | { kind: "armed" }
  | { kind: "scrolling" }
  /** the gesture ended with fingers still down: wait for them all to lift */
  | { kind: "done" };

export interface State {
  phase: Phase;
  fingers: ReadonlyMap<number, Point>;
  /** where the pointer is: the finger in touch and pan modes, a cursor of its own in trackpad mode */
  cursor: Point | null;
}

export const initial: State = { phase: { kind: "idle" }, fingers: new Map(), cursor: null };

const clamp = (p: Point, b: Bounds): Point => ({
  x: Math.min(b.right - 1, Math.max(b.left, p.x)),
  y: Math.min(b.bottom - 1, Math.max(b.top, p.y)),
});
const middle = (b: Bounds): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
const none: Output = { kind: "hint", hint: { kind: "none" } };

/** One finger event. `bounds` is the desktop on screen; the cursor never leaves it. */
export function step(state: State, input: Input, mode: Mode, bounds: Bounds): [State, Output[]] {
  const fingers = new Map(state.fingers);
  const cursorOf = (finger: Point) => (mode === "trackpad" ? (state.cursor ?? middle(bounds)) : clamp(finger, bounds));
  const next = (phase: Phase, cursor = state.cursor): State => ({ phase, fingers, cursor });

  switch (input.kind) {
    case "down": {
      fingers.set(input.id, input.at);
      if (fingers.size === 1) return [next({ kind: "pending", travel: 0 }), [{ kind: "hint", hint: { kind: "holding", at: input.at } }]];
      if (state.phase.kind === "armed") return [next(state.phase), []]; // a drag keeps going
      return [next({ kind: "scrolling" }), [none]];
    }

    case "held": {
      const finger = [...fingers.values()][0];
      if (state.phase.kind !== "pending" || fingers.size !== 1 || !finger) return [state, []];
      const at = cursorOf(finger);
      return [
        next({ kind: "armed" }, at),
        [{ kind: "point", at, down: false }, { kind: "press", at }, { kind: "hint", hint: { kind: "armed", at: finger } }],
      ];
    }

    case "move": {
      const last = fingers.get(input.id);
      if (!last) return [state, []];
      fingers.set(input.id, input.at);
      const by = { x: input.at.x - last.x, y: input.at.y - last.y };
      const phase = state.phase;
      /** one finger sliding, by mode */
      const slide = (): [State, Output[]] => {
        if (mode === "touch") return [next({ kind: "sliding" }), [{ kind: "scroll", at: clamp(input.at, bounds), by }]];
        if (mode === "pan") return [next({ kind: "sliding" }), [{ kind: "pan", by }]];
        const from = state.cursor ?? middle(bounds);
        const at = clamp({ x: from.x + by.x * TRACKPAD_SPEED, y: from.y + by.y * TRACKPAD_SPEED }, bounds);
        return [next({ kind: "sliding" }, at), [{ kind: "point", at, down: false }]];
      };
      switch (phase.kind) {
        case "pending": {
          const travel = phase.travel + Math.hypot(by.x, by.y);
          if (travel <= SLOP) return [next({ kind: "pending", travel }), []];
          const [after, out] = slide();
          return [after, [none, ...out]];
        }
        case "sliding":
          return slide();
        case "armed": {
          const from = state.cursor ?? cursorOf(input.at);
          const at =
            mode === "trackpad" ? clamp({ x: from.x + by.x * TRACKPAD_SPEED, y: from.y + by.y * TRACKPAD_SPEED }, bounds) : clamp(input.at, bounds);
          return [next(phase, at), [{ kind: "point", at, down: true }, { kind: "hint", hint: { kind: "armed", at: input.at } }]];
        }
        case "scrolling": {
          // every finger moves the page; together they move it once
          const share = { x: by.x / fingers.size, y: by.y / fingers.size };
          const at = mode === "trackpad" ? (state.cursor ?? middle(bounds)) : clamp(input.at, bounds);
          return [next(phase), [{ kind: "scroll", at, by: share }]];
        }
        case "idle":
        case "done":
          return [next(phase), []];
      }
    }

    case "up": {
      const finger = fingers.get(input.id);
      fingers.delete(input.id);
      const phase = state.phase;
      const after = fingers.size === 0 ? { kind: "idle" as const } : { kind: "done" as const };
      if (phase.kind === "pending" && finger) {
        const at = cursorOf(finger);
        return [next(after, at), [none, { kind: "point", at, down: false }, { kind: "press", at }, { kind: "release", at }]];
      }
      if (phase.kind === "armed") {
        if (fingers.size > 0) return [next(phase), []]; // the dragging finger may be another one
        const at = state.cursor ?? cursorOf(finger ?? middle(bounds));
        return [next(after), [none, { kind: "release", at }]];
      }
      if (phase.kind === "scrolling" && fingers.size > 0) return [next(phase), []];
      return [next(after), phase.kind === "idle" ? [] : [none]];
    }
  }
}
