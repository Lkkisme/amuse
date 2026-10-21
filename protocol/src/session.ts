/**
 * What a client holds: typed calls out, ordered events in. A WebSocket
 * client and an in-process server both implement it.
 */
import type { Chat } from "./chats.ts";
import type { Envelope, State } from "./events.ts";
import type { Method, Params, Results } from "./rpc.ts";

export interface Session {
  call<M extends Method>(method: M, params: Params[M]): Promise<Results[M]>;
  /** Updates in order; returns unsubscribe. */
  subscribe(listener: (update: Update) => void): () => void;
}

/**
 * What a subscriber receives: a chat's next event, the chats as they now
 * are, or — when a client could not catch up on a chat (the server restarted
 * without its log, or lost it) — that chat's whole state to start over from.
 * A server host never sends resets.
 */
export type Update = { kind: "event"; chat: string; envelope: Envelope } | { kind: "reset"; chat: string; state: State } | { kind: "chats"; chats: Chat[] };
