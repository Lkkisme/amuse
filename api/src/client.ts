/**
 * A protocol Session over a WebSocket, for browsers (and Node 22+, which has
 * a global WebSocket). Results and events are parsed with the protocol
 * schemas on arrival, so a misbehaving server fails loudly at the boundary.
 * Reconnects with backoff and replays each chat's missed events from its last seq.
 */
import {
  type Chat,
  type Envelope,
  type Method,
  Notification,
  type Params,
  Response,
  type Results,
  type Session,
  type State,
  type Update,
  parseResult,
} from "@remuse/protocol";

type Pending = { settle: (raw: unknown) => void; fail: (error: Error) => void };

export function connect(url: string): Session & { close(): void } {
  const listeners = new Set<(update: Update) => void>();
  const pending = new Map<number, Pending>();
  const outbox: string[] = [];
  let socket: WebSocket | null = null;
  let nextId = 0;
  /** each chat's last seq seen: what a reconnect catches up from */
  const lastSeq = new Map<string, number>();
  let retry = 0;
  let closed = false;

  const deliver = (chat: string, envelope: Envelope) => {
    if (envelope.seq <= (lastSeq.get(chat) ?? 0)) return;
    lastSeq.set(chat, envelope.seq);
    for (const listener of listeners) listener({ kind: "event", chat, envelope });
  };
  /** The server could not replay what we missed: start over from its state. */
  const reset = (chat: string, state: State) => {
    lastSeq.set(chat, state.seq);
    for (const listener of listeners) listener({ kind: "reset", chat, state });
  };
  const chats = (list: Chat[]) => {
    for (const listener of listeners) listener({ kind: "chats", chats: list });
  };

  const open = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      const resumed = retry > 0;
      retry = 0;
      outbox.splice(0).forEach((frame) => ws.send(frame));
      if (resumed) {
        void call("chats.list", {}).then((r) => chats(r.chats));
        for (const [chat, since] of lastSeq)
          void call("session.sync", { chat, since }).then((r) => (r.kind === "events" ? r.events.forEach((e) => deliver(chat, e)) : reset(chat, r.state)));
      }
    };
    ws.onmessage = ({ data }) => {
      if (typeof data !== "string") return;
      const raw: unknown = JSON.parse(data);
      const note = Notification.safeParse(raw);
      if (note.success) {
        const push = note.data.params;
        return push.kind === "event" ? deliver(push.chat, push.envelope) : chats(push.chats);
      }
      const response = Response.parse(raw);
      const entry = typeof response.id === "number" ? pending.get(response.id) : undefined;
      if (!entry || typeof response.id !== "number") return;
      pending.delete(response.id);
      if ("error" in response) entry.fail(new Error(response.error.message));
      else entry.settle(response.result);
    };
    ws.onclose = () => {
      socket = null;
      for (const entry of pending.values()) entry.fail(new Error("disconnected"));
      pending.clear();
      if (!closed) setTimeout(open, Math.min(10_000, 500 * 2 ** retry++));
    };
  };

  function call<M extends Method>(method: M, params: Params[M]): Promise<Results[M]> {
    const id = ++nextId;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<Results[M]>((resolve, reject) => {
      pending.set(id, {
        settle: (raw) => {
          // a snapshot the caller fetched is where we now stand, so a later reconnect catches up from there;
          // returned events move us forward only as they are delivered
          if (method === "session.sync" && "chat" in params && typeof params.chat === "string") {
            const synced = parseResult["session.sync"](raw);
            if (synced.kind === "snapshot") lastSeq.set(params.chat, synced.state.seq);
          }
          resolve(parseResult[method](raw));
        },
        fail: reject,
      });
      if (socket?.readyState === WebSocket.OPEN) socket.send(frame);
      else outbox.push(frame);
    });
  }

  open();
  return {
    call,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}
