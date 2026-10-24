/**
 * A protocol Session over a WebSocket, for browsers (and Node 22+, which has
 * a global WebSocket). Results and events are parsed with the protocol
 * schemas on arrival, so a misbehaving server fails loudly at the boundary.
 * Reconnects with backoff and replays each chat's missed events from its last seq; `resume()` takes it up at once
 * (a page that comes back says so, rather than waiting out the backoff that was frozen with it).
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
} from "@amuse/protocol";

type Pending = { settle: (raw: unknown) => void; fail: (error: Error) => void };

/**
 * A call the server answered with an error: its words, and its JSON-RPC code (the protocol's `errors`: the PIN's, say).
 */
export class CallFailed extends Error {
  readonly code: number;
  /** a rejected command's rejection (`{ kind, … }`), for a client to say in its own words */
  readonly data: unknown;
  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * A call whose socket dropped before it was answered (a phone's browser freezes the page in the background, and the
 * socket with it). Its own kind, so a page says it in the user's language instead of showing "disconnected".
 */
export class Dropped extends Error {
  constructor(message = "the connection dropped") {
    super(message);
  }
}

/**
 * Calls that must not go twice: a drop may have come after the server acted on them, and doing them again would
 * send the message twice, answer the card again, or start another task. Every other call is a read or a write that
 * leaves the same state when repeated (a permission, a model), and is sent again once after the reconnect.
 */
const once = new Set<Method>([
  "chat.send",
  "chat.retry",
  "chats.create",
  "approval.resolve",
  "connection.begin",
  "browser.open",
  "schedule.control",
  "apps.connect",
  "apps.connectKey",
  "goals.add",
  "secret.answer",
  "secrets.add",
  "keys.login",
  "keys.answer",
  "sandbox.reset",
]);

export interface ConnectOptions {
  /** the words for a call lost to a drop, in the user's language (what a page shows as it is) */
  unreachable?: () => string;
  /** how long a repeatable call waits for the reconnect, in ms, before it says the server cannot be reached */
  patience?: number;
}

export function connect(url: string, options: ConnectOptions = {}): Session & { close(): void; resume(): void } {
  const { unreachable = () => "the connection dropped", patience = 15_000 } = options;
  const listeners = new Set<(update: Update) => void>();
  const pending = new Map<number, Pending>();
  const outbox: string[] = [];
  let socket: WebSocket | null = null;
  let nextId = 0;
  /** each chat's last seq seen: what a reconnect catches up from */
  const lastSeq = new Map<string, number>();
  let retry = 0;
  let closed = false;
  /** the retry that is waiting, so coming back can take it up now instead */
  let waiting: ReturnType<typeof setTimeout> | null = null;
  /** calls waiting for a socket that is up, to be sent again */
  const rejoin = new Set<() => void>();

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
      if (socket !== ws) return; // a newer socket is the one that counts
      const resumed = retry > 0;
      retry = 0;
      outbox.splice(0).forEach((frame) => ws.send(frame));
      rejoin.forEach((go) => go());
      if (resumed) {
        void call("chats.list", {}).then((r) => chats(r.chats));
        for (const [chat, since] of lastSeq)
          void call("session.sync", { chat, since }).then((r) => (r.kind === "events" ? r.events.forEach((e) => deliver(chat, e)) : reset(chat, r.state)));
      }
    };
    ws.onmessage = ({ data }) => {
      if (socket !== ws) return; // a newer socket is the one that counts
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
      if ("error" in response) entry.fail(new CallFailed(response.error.message, response.error.code, response.error.data));
      else entry.settle(response.result);
    };
    ws.onclose = () => {
      if (socket !== ws) return; // we let this one go ourselves: its close is not the connection dropping
      socket = null;
      for (const entry of pending.values()) entry.fail(new Dropped(unreachable()));
      pending.clear();
      // what waited to go out has failed with them: sent later, a message the user takes back would arrive anyway
      outbox.length = 0;
      if (!closed && waiting === null)
        waiting = setTimeout(() => {
          waiting = null;
          if (!closed) open();
        }, Math.min(10_000, 500 * 2 ** retry++));
    };
  };

  /**
   * Take the connection up again now, without waiting out the retry: a page that comes back (a phone's browser
   * freezes it, and its timers, with it) asks for this, and so does a call that finds no socket at all.
   */
  const resume = () => {
    const state = socket?.readyState;
    // nothing to take up while it is up, or already on its way up
    if (closed || state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    if (waiting !== null) {
      clearTimeout(waiting);
      waiting = null;
    }
    retry = 0;
    const stale = socket; // a half-open one from the background: dropped, and its close ignored
    socket = null;
    stale?.close();
    open();
  };

  /** Resolves once a socket is up, rejects as Dropped when none comes within `patience`. */
  const reconnected = () =>
    new Promise<void>((resolve, reject) => {
      if (socket?.readyState === WebSocket.OPEN) return resolve();
      const go = () => {
        clearTimeout(timer);
        rejoin.delete(go);
        resolve();
      };
      const timer = setTimeout(() => {
        rejoin.delete(go);
        reject(new Dropped(unreachable()));
      }, patience);
      rejoin.add(go);
      resume();
    });

  /** A call; one lost to a drop that is safe to repeat waits for the reconnect and goes once more. */
  function call<M extends Method>(method: M, params: Params[M]): Promise<Results[M]> {
    return send(method, params).catch((error: unknown) => {
      if (!(error instanceof Dropped) || once.has(method) || closed) throw error;
      return reconnected().then(() => send(method, params));
    });
  }

  function send<M extends Method>(method: M, params: Params[M]): Promise<Results[M]> {
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
      else {
        // no socket (it dropped, or the page is only now coming back): it goes as soon as there is one
        outbox.push(frame);
        resume();
      }
    });
  }

  open();
  return {
    call,
    resume,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      if (waiting !== null) clearTimeout(waiting);
      waiting = null;
      socket?.close();
    },
  };
}
