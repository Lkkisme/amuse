/**
 * Swiping the phone's two pages (the sidebar, from the left; the Amuse panel, from the right) as a pure step
 * function: finger events in, what the page does out. A page follows the finger as it is dragged, and on lifting
 * settles open or closed by how far it came and how fast the finger was going.
 *
 *   nothing open     swipe right: the sidebar opens; swipe left: the Amuse panel opens
 *   sidebar open     swipe left closes it
 *   panel open       swipe right closes it
 *
 * Nothing is claimed until the movement is clearly horizontal: INTENT px of travel, more across than down. A touch
 * that starts near the screen edge the page comes from is readier (it needs less travel, may be more diagonal, and
 * settles open from less distance). A touch that starts in the system's own edge zone is left to the system, and a
 * touch that starts on content that can still scroll sideways that way is left to the content. A touch that is not
 * claimed at its first reading is never claimed: a vertical scroll that turns sideways does not open anything.
 * All points are client (CSS px) coordinates, times in ms.
 */
import type { Point } from "./touch-gestures.ts";

export type Panel = "sidebar" | "muse";

/** Travel (px) before the direction is read. */
export const INTENT = 10;
/** The same for a touch that starts at the edge the page comes from. */
export const EDGE_INTENT = 6;
/** How much more across than down the movement must be: |dx| > RATIO × |dy| (at the edge: just more across). */
export const RATIO = 1.5;
/** A touch that starts this close (px) to the edge a page comes from is an edge swipe. */
export const EDGE = 40;
/** Speed (px/ms) from which the direction of the finger, not the distance, decides. */
export const FLING = 0.5;
/** How far (of the way) a page must be to settle open, when the finger was not fast; opening from the edge needs less. */
export const OPEN_AT = 0.5;
export const EDGE_OPEN_AT = 0.3;
/** The finger's speed is read over its last VELOCITY_WINDOW ms. */
export const VELOCITY_WINDOW = 100;

/** Whether content under the finger can still scroll sideways: `left` while the finger goes left, `right` going right. */
export interface Scrolls {
  left: boolean;
  right: boolean;
}

export type Input =
  | {
      kind: "down";
      at: Point;
      time: number;
      /** the screen's width (the pages cover it) */
      width: number;
      /** the page that is open (the top one), if any */
      open: Panel | null;
      /** width (px) of each screen edge that is the system's (its back gesture), where a touch is not ours */
      inset: number;
      scrolls: Scrolls;
    }
  | { kind: "move"; at: Point; time: number }
  | { kind: "up"; time: number }
  /** the system took the touch */
  | { kind: "cancel" };

export type Output =
  /** the touch is claimed: the page is there, `progress` of the way open (the caller stops the browser's own handling) */
  | { kind: "begin"; panel: Panel; progress: number }
  | { kind: "drag"; panel: Panel; progress: number }
  /** the finger lifted: the page goes on to open or closed */
  | { kind: "settle"; panel: Panel; open: boolean };

type Phase =
  | { kind: "idle" }
  /** finger down, direction not read yet */
  | { kind: "pending"; start: Point; time: number; width: number; open: Panel | null; scrolls: Scrolls }
  /** the page follows the finger: `from` is how open it was when the touch began (0 or 1), `startX` where the finger was */
  | { kind: "dragging"; panel: Panel; from: number; startX: number; width: number; edge: boolean; progress: number; samples: Sample[] }
  /** not ours (vertical, the system's, the content's): until the finger lifts */
  | { kind: "ignored" };

interface Sample {
  x: number;
  time: number;
}

export interface State {
  phase: Phase;
}

export const initial: State = { phase: { kind: "idle" } };

const ignored: State = { phase: { kind: "ignored" } };
const clamp = (progress: number) => Math.min(1, Math.max(0, progress));

/** Whether a touch at `x` is close to the edge the page `panel` comes from. */
const atEdge = (x: number, width: number, panel: Panel) => (panel === "sidebar" ? x : width - x) <= EDGE;

/** Which page a movement to the right (`dx` > 0) or left moves, and how open it is to begin with; null: nothing moves. */
function target(dx: number, open: Panel | null): { panel: Panel; from: number } | null {
  if (open === null) return dx > 0 ? { panel: "sidebar", from: 0 } : { panel: "muse", from: 0 };
  if (open === "sidebar") return dx < 0 ? { panel: "sidebar", from: 1 } : null;
  return dx > 0 ? { panel: "muse", from: 1 } : null;
}

/** How open the page is with the finger `dx` px from where it began: the sidebar goes with the finger, the panel against it. */
const progressOf = (panel: Panel, from: number, dx: number, width: number) => clamp(from + (panel === "sidebar" ? dx : -dx) / width);

/** The page's speed toward open (progress-widths per ms, in px/ms of the finger) over the last VELOCITY_WINDOW ms. */
function velocity(panel: Panel, samples: Sample[], time: number): number {
  const recent = samples.filter((s) => s.time >= time - VELOCITY_WINDOW);
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || last.time === first.time) return 0;
  const speed = (last.x - first.x) / (last.time - first.time);
  return panel === "sidebar" ? speed : -speed;
}

/** Whether a page lifted at `progress` goes on to open: a fast finger decides by its direction, a slow one by the distance. */
export function opens(progress: number, speed: number, edge: boolean): boolean {
  if (Math.abs(speed) >= FLING) return speed > 0;
  return progress >= (edge ? EDGE_OPEN_AT : OPEN_AT);
}

/** One finger event. Only one finger counts: the caller passes the first one's events. */
export function step(state: State, input: Input): [State, Output[]] {
  const phase = state.phase;
  switch (input.kind) {
    case "down": {
      const { at, width, inset } = input;
      if (at.x < inset || at.x > width - inset) return [ignored, []]; // the system's edge
      return [{ phase: { kind: "pending", start: at, time: input.time, width, open: input.open, scrolls: input.scrolls } }, []];
    }

    case "move": {
      if (phase.kind === "dragging") {
        const progress = progressOf(phase.panel, phase.from, input.at.x - phase.startX, phase.width);
        const samples = [...phase.samples, { x: input.at.x, time: input.time }].filter((s) => s.time >= input.time - VELOCITY_WINDOW);
        return [{ phase: { ...phase, progress, samples } }, [{ kind: "drag", panel: phase.panel, progress }]];
      }
      if (phase.kind !== "pending") return [state, []];
      const dx = input.at.x - phase.start.x;
      const dy = input.at.y - phase.start.y;
      const moved = target(dx, phase.open);
      const edge = moved !== null && phase.open === null && atEdge(phase.start.x, phase.width, moved.panel);
      if (Math.hypot(dx, dy) < (edge ? EDGE_INTENT : INTENT)) return [state, []];
      const across = edge ? Math.abs(dx) > Math.abs(dy) : Math.abs(dx) > RATIO * Math.abs(dy);
      const consumed = dx < 0 ? phase.scrolls.left : phase.scrolls.right;
      if (!moved || !across || consumed) return [ignored, []];
      const progress = progressOf(moved.panel, moved.from, dx, phase.width);
      const { width } = phase;
      const samples = [{ x: phase.start.x, time: phase.time }, { x: input.at.x, time: input.time }];
      return [
        { phase: { kind: "dragging", panel: moved.panel, from: moved.from, startX: phase.start.x, width, edge, progress, samples } },
        [{ kind: "begin", panel: moved.panel, progress }],
      ];
    }

    case "up": {
      if (phase.kind !== "dragging") return [initial, []];
      const speed = velocity(phase.panel, phase.samples, input.time);
      return [initial, [{ kind: "settle", panel: phase.panel, open: opens(phase.progress, speed, phase.edge) }]];
    }

    case "cancel": {
      if (phase.kind !== "dragging") return [initial, []];
      return [initial, [{ kind: "settle", panel: phase.panel, open: phase.from === 1 }]];
    }
  }
}
