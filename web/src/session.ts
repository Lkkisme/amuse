/**
 * The web app's only link to a server is a protocol Session. The
 * conversation shown on screen is the fold of those events with the
 * protocol's `apply`, so the UI never holds its own copy of server state.
 */
import { useEffect, useState } from "react";
import { type Session, type State, apply, empty } from "@remuse/protocol";

/** Live conversation state: synced on mount, advanced by events, replaced on a reset; resyncs on a gap. */
export function useConversation(session: Session): State {
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

  return state;
}
