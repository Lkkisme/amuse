/**
 * A protocol Session over a WebSocket, for browsers (and Node 22+, which has
 * a global WebSocket). Results and events are parsed with the protocol
 * schemas on arrival, so a misbehaving server fails loudly at the boundary.
 * Reconnects with backoff and replays missed events from the last seq.
 */
import {
  type Envelope,
  type Method,
  Notification,
  type Params,
  Response,
  type Results,
  type Session,
  parseResult,
} from "@remuse/protocol";

type Pending = { settle: (raw: unknown) => void; fail: (error: Error) => void };

export function connect(url: string): Session & { close(): void } {
  const listeners = new Set<(envelope: Envelope) => void>();
  const pending = new Map<number, Pending>();
  const outbox: string[] = [];
  let socket: WebSocket | null = null;
  let nextId = 0;
  let lastSeq = 0;
  let retry = 0;
  let closed = false;

  const deliver = (envelope: Envelope) => {
    if (envelope.seq <= lastSeq) return;
    lastSeq = envelope.seq;
    for (const listener of listeners) listener(envelope);
  };

  const open = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      const resumed = retry > 0;
      retry = 0;
      outbox.splice(0).forEach((frame) => ws.send(frame));
      if (resumed && lastSeq > 0)
        void call("session.sync", { since: lastSeq }).then((r) => (r.kind === "events" ? r.events.forEach(deliver) : undefined));
    };
    ws.onmessage = ({ data }) => {
      if (typeof data !== "string") return;
      const raw: unknown = JSON.parse(data);
      const note = Notification.safeParse(raw);
      if (note.success) return deliver(note.data.params);
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
      pending.set(id, { settle: (raw) => resolve(parseResult[method](raw)), fail: reject });
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
