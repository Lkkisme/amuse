/**
 * The web app's only link to a server: call methods, receive events. The
 * conversation shown on screen is the fold of those events with the
 * protocol's `apply`, so the UI never holds its own copy of server state.
 */
import { useEffect, useState } from "react";
import { type Envelope, type Method, type Params, type Results, type State, apply, empty } from "@remuse/protocol";

export interface Session {
  call<M extends Method>(method: M, params: Params[M]): Promise<Results[M]>;
  /** Events in seq order; returns unsubscribe. */
  subscribe(listener: (envelope: Envelope) => void): () => void;
}

/** Live conversation state: synced on mount, then advanced by events; resyncs on a gap. */
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

    const unsubscribe = session.subscribe((envelope) =>
      setState((s) => {
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
