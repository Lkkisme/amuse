/**
 * What a client holds: typed calls out, ordered events in. A WebSocket
 * client and an in-process server both implement it.
 */
import type { Envelope } from "./events.ts";
import type { Method, Params, Results } from "./rpc.ts";

export interface Session {
  call<M extends Method>(method: M, params: Params[M]): Promise<Results[M]>;
  /** Events in seq order; returns unsubscribe. */
  subscribe(listener: (envelope: Envelope) => void): () => void;
}
