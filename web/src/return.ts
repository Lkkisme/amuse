/**
 * Coming back to the page. A phone's browser freezes a backgrounded page, and the
 * socket with it: the retry that would take the connection up again is frozen too,
 * so the app can sit there "disconnected" long after the user is looking at it.
 * So the page says when it is back — on screen again, shown again from the bfcache,
 * or the network back — and the session reconnects at once.
 */

/** Where "the page is back" comes from: the browser's own events, or a test's. */
export interface Returns {
  events: EventTarget;
  visible: () => boolean;
}

/** The browser's: the window's events, and whether the page is on screen. */
export const browserReturns = (): Returns => ({
  events: window,
  visible: () => document.visibilityState === "visible",
});

/** Run `resume` whenever the page comes back; returns how to stop listening. */
export function resumeOnReturn(resume: () => void, from: Returns = browserReturns()): () => void {
  const back = () => {
    if (from.visible()) resume();
  };
  from.events.addEventListener("visibilitychange", back);
  from.events.addEventListener("pageshow", back);
  from.events.addEventListener("online", back);
  return () => {
    from.events.removeEventListener("visibilitychange", back);
    from.events.removeEventListener("pageshow", back);
    from.events.removeEventListener("online", back);
  };
}
