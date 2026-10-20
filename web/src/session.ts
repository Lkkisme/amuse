/**
 * The web app's only link to a server is a protocol Session. The
 * conversation shown on screen is the fold of those events with the
 * protocol's `apply`, so the UI never holds its own copy of server state.
 * It holds only the recent end of the feed: older entities come a page at
 * a time as the user scrolls back, and go again when they return to the end.
 */
import { useCallback, useEffect, useState } from "react";
import { type Session, type State, apply, empty, prepend, recent } from "@remuse/protocol";

/** Entities fetched per page back, and how many are kept on letting go. */
const PAGE = 50;

export interface Conversation {
  state: State;
  /** Fetch the page before the oldest entity held. */
  older(): Promise<void>;
  /** Let go of the pages fetched back (the user is at the end again). */
  release(): void;
}

/** Live conversation state: synced on mount, advanced by events, replaced on a reset; resyncs on a gap. */
export function useConversation(session: Session): Conversation {
  const [state, setState] = useState<State>(empty);

  useEffect(() => {
    let live = true;
    const resync = (since: number | null) =>
      session.call("session.sync", { since }).then((result) => {
        if (!live) return;
        switch (result.kind) {
          case "snapshot":
            return setState(result.state);
          case "events":
            return setState((s) => result.events.reduce((acc, e) => (e.seq === acc.seq + 1 ? apply(acc, e) : acc), s));
        }
      });

    const unsubscribe = session.subscribe((update) =>
      setState((s) => {
        if (update.kind === "reset") return update.state; // the server started over: so do we
        const { envelope } = update;
        if (envelope.seq <= s.seq) return s; // already have it
        if (envelope.seq === s.seq + 1) return apply(s, envelope);
        void resync(s.seq); // missed some: catch up
        return s;
      }),
    );
    void resync(null);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [session]);

  const { earlier } = state;
  const older = useCallback(async () => {
    if (earlier === 0) return;
    const page = await session.call("session.history", { before: earlier, limit: PAGE });
    // a page that crossed an event in flight does not fit and is dropped; scrolling asks again
    setState((s) => prepend(s, page) ?? s);
  }, [session, earlier]);

  const release = useCallback(() => setState((s) => (s.entities.length > 2 * PAGE ? recent(s, PAGE) : s)), []);

  return { state, older, release };
}
