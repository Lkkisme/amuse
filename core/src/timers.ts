/** Scheduling, injectable so tests and scripts can run without waiting. */
export interface Timers<H> {
  set(ms: number, fn: () => void): H;
  clear(handle: H): void;
}

export const realTimers: Timers<ReturnType<typeof setTimeout>> = {
  set: (ms, fn) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};
