/**
 * A browser task's step budget: 40 steps a stretch. When a stretch's steps are used up the run pauses and hands Amuse
 * a short report; Amuse continues it (another stretch, with whatever it says), stops it, or nothing comes and the run
 * ends as stopped, with the report kept as its result. The pause is between the run and Amuse: the browser's card
 * shows nothing of it (what the run is doing, which the agent reads with every turn, says it waits).
 */
import type { Timers } from "@amuse/core";

/** What Amuse decided about a pause: go on (with what it said, if anything), or stop the task. */
export type Decision = { kind: "continue"; said: string } | { kind: "stopped" };

/** A run's step budget, one stretch at a time. */
export interface Stretch {
  /** Take a step: false when this stretch's steps are used up, and the run must pause before it does anything else. */
  step(): boolean;
  /** A fresh stretch: the run was given a new job. */
  fresh(): void;
  /** Pause with this report, and wait for Amuse: what it decided. */
  pause(report: string): Promise<Decision>;
  /** What Amuse says while the run is paused: true when the run takes it as its continue. */
  hear(said: string): boolean;
}

export function stretch<H>(options: {
  /** how many steps one stretch is */
  steps: number;
  /** how long a pause waits for Amuse before the run ends as stopped */
  forMs: number;
  /** the run was stopped, or its browser closed: nothing is waited for any more */
  stop: AbortSignal;
  /** Amuse hears the report (a waking note), and what the run is doing says it waits on Amuse */
  paused: (report: string) => void;
  /** Nothing came in time: end the run as stopped, with the report kept as its result */
  waitedOut: (report: string) => void;
  timers: Timers<H>;
}): Stretch {
  let taken = 0;
  let timer: H | null = null;
  let settle: ((decision: Decision) => void) | null = null;

  /** The wait, if any, is over. */
  const done = (decision: Decision) => {
    if (timer !== null) options.timers.clear(timer);
    timer = null;
    const waiting = settle;
    settle = null;
    waiting?.(decision);
  };
  options.stop.addEventListener("abort", () => done({ kind: "stopped" }), { once: true });

  return {
    step: () => ++taken <= options.steps,
    fresh: () => void (taken = 0),
    hear(said) {
      if (settle === null) return false;
      taken = 0; // a continue is another stretch
      done({ kind: "continue", said });
      return true;
    },
    async pause(report) {
      if (options.stop.aborted) return { kind: "stopped" };
      options.paused(report);
      return await new Promise<Decision>((resolve) => {
        settle = resolve;
        timer = options.timers.set(options.forMs, () => {
          done({ kind: "stopped" }); // nothing is waited for any more
          options.waitedOut(report); // the run ends as stopped, with what it reported kept
        });
      });
    },
  };
}
