/** A protocol Session whose transport can recover without replaying user actions. */
import {
  type Chat, type Envelope, type Method, Notification, type Params, Response,
  type Results, type Session, type State, type Update, parseResult,
} from "@amuse/protocol";

type Pending = { settle: (raw: unknown) => void; fail: (error: Error) => void };

/** Native events carry no credentials. Ordinary browsers and Node need no native bridge. */
export function observeRecovery(listener: (reason: "resume" | "network" | "pause") => void): {
  active(): boolean;
  close(): void;
} {
  let paused = false;
  const active = () => !paused && (typeof document === "undefined" || document.visibilityState !== "hidden") &&
    (typeof navigator === "undefined" || navigator.onLine !== false);
  if (typeof window === "undefined") return { active, close() {} };
  const resume = () => { paused = false; if (active()) listener("resume"); };
  const network = () => { if (active()) listener("network"); };
  const pause = () => { paused = true; listener("pause"); };
  const visibility = () => document.visibilityState === "hidden" ? pause() : resume();
  const bindings: [EventTarget, string, () => void][] = [
    [window, "online", network], [window, "offline", () => listener("pause")],
    [window, "pageshow", resume], [window, "pagehide", pause],
    [window, "amuse:resume", resume], [window, "amuse:network-change", network], [window, "amuse:pause", pause],
  ];
  if (typeof document !== "undefined") bindings.push([document, "visibilitychange", visibility]);
  for (const [target, name, fn] of bindings) target.addEventListener(name, fn);
  return { active, close() { for (const [target, name, fn] of bindings) target.removeEventListener(name, fn); } };
}

/** Policy/auth/protocol failures need an explicit user retry, not a reconnect loop. */
export const transientClose = (code: number) => ![1002, 1003, 1007, 1008, 1009, 1010].includes(code) && code < 4000;

export function connect(url: string): Session & { close(): void } {
  const listeners = new Set<(update: Update) => void>();
  const pending = new Map<number, Pending>();
  const outbox: string[] = [];
  const lastSeq = new Map<string, number>();
  // A read requested during the first failed handshake still needs a snapshot on recovery.
  const syncChats = new Set<string>();
  let socket: WebSocket | null = null;
  let nextId = 0;
  let retry = 0;
  let closed = false;
  let terminal = false;
  let opened = false;
  let reconnecting = false;
  let epoch = 0;
  let healthEpoch = 0;
  let probeId: number | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probing = false;

  const deliver = (chat: string, envelope: Envelope) => {
    if (envelope.seq <= (lastSeq.get(chat) ?? 0)) return;
    lastSeq.set(chat, envelope.seq);
    for (const listener of listeners) listener({ kind: "event", chat, envelope });
  };
  const reset = (chat: string, state: State) => {
    lastSeq.set(chat, state.seq);
    for (const listener of listeners) listener({ kind: "reset", chat, state });
  };
  const chats = (list: Chat[]) => {
    for (const listener of listeners) listener({ kind: "chats", chats: list });
  };
  const failPending = () => {
    for (const entry of pending.values()) entry.fail(new Error("disconnected"));
    pending.clear();
    outbox.length = 0;
  };
  const stopHealth = () => {
    healthEpoch++;
    clearTimeout(heartbeatTimer); clearTimeout(probeTimer);
    heartbeatTimer = probeTimer = undefined;
    if (probeId !== undefined) { pending.get(probeId)?.fail(new Error("suspended")); pending.delete(probeId); }
    probeId = undefined;
    probing = false;
  };
  const schedule = (immediate = false) => {
    if (closed || terminal || !recovery.active() || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => { retryTimer = undefined; open(); }, immediate ? 0 : Math.min(10_000, 500 * 2 ** Math.min(5, retry++)));
  };
  const disconnect = (ws: WebSocket, again: boolean) => {
    if (socket !== ws) return;
    socket = null;
    reconnecting = true;
    epoch++;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    clearTimeout(connectTimer); connectTimer = undefined;
    stopHealth(); failPending();
    ws.close();
    if (again) schedule();
  };
  const heartbeat = () => {
    clearTimeout(heartbeatTimer);
    if (!closed && !terminal && recovery.active()) heartbeatTimer = setTimeout(probe, 25_000);
  };
  /** A reply on this exact socket proves it survived a radio/VPN change. */
  const probe = () => {
    if (closed || terminal || !recovery.active()) return;
    const ws = socket;
    if (!ws) { clearTimeout(retryTimer); retryTimer = undefined; schedule(true); return; }
    if (ws.readyState !== WebSocket.OPEN || probing) return;
    probing = true;
    const generation = epoch;
    const health = ++healthEpoch;
    probeId = nextId + 1;
    probeTimer = setTimeout(() => { if (socket === ws && epoch === generation && healthEpoch === health) disconnect(ws, true); }, 5_000);
    void call("chats.list", {}).then(({ chats: list }) => {
      if (socket === ws && epoch === generation && healthEpoch === health) chats(list);
    }, () => {}).finally(() => {
      if (socket !== ws || epoch !== generation || healthEpoch !== health) return;
      clearTimeout(probeTimer); probeTimer = undefined; probeId = undefined; probing = false; heartbeat();
    });
  };
  const recovery = observeRecovery((reason) => {
    if (reason === "pause") {
      clearTimeout(retryTimer); retryTimer = undefined;
      stopHealth();
      return;
    }
    if (!closed && !terminal) probe();
  });

  function open() {
    if (closed || terminal || socket || !recovery.active()) return;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { terminal = true; failPending(); return; }
    socket = ws;
    const generation = ++epoch;
    connectTimer = setTimeout(() => { if (socket === ws) disconnect(ws, true); }, 12_000);
    ws.onopen = () => {
      if (socket !== ws || epoch !== generation || closed) return;
      clearTimeout(connectTimer); connectTimer = undefined;
      const resumed = reconnecting;
      reconnecting = false;
      opened = true;
      retry = 0;
      // Only calls waiting for the very first connection can be sent here.
      for (const frame of outbox.splice(0)) ws.send(frame);
      if (resumed) {
        void call("chats.list", {}).then((r) => chats(r.chats), () => {});
        for (const chat of new Set([...lastSeq.keys(), ...syncChats]))
          void call("session.sync", { chat, since: lastSeq.get(chat) ?? null }).then((r) => {
            if (socket !== ws) return;
            if (r.kind === "events") r.events.forEach((e) => deliver(chat, e));
            else reset(chat, r.state);
          }, () => {});
      }
      heartbeat();
    };
    ws.onmessage = ({ data }) => {
      if (socket !== ws || epoch !== generation || typeof data !== "string") return;
      try {
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
      } catch {
        terminal = true;
        disconnect(ws, false);
      }
    };
    ws.onclose = ({ code }) => {
      if (socket !== ws) return;
      terminal = !transientClose(code);
      disconnect(ws, !terminal);
    };
    // Close carries the status. Connect/probe deadlines cover a silent peer.
    ws.onerror = () => {};
  }

  function call<M extends Method>(method: M, params: Params[M]): Promise<Results[M]> {
    if (method === "session.sync" && "chat" in params && typeof params.chat === "string") syncChats.add(params.chat);
    if (closed || terminal || (opened && socket?.readyState !== WebSocket.OPEN)) return Promise.reject(new Error("disconnected"));
    const id = ++nextId;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<Results[M]>((resolve, reject) => {
      pending.set(id, {
        settle: (raw) => {
          try {
            if (method === "session.sync" && "chat" in params && typeof params.chat === "string") {
              const synced = parseResult["session.sync"](raw);
              if (synced.kind === "snapshot") lastSeq.set(params.chat, synced.state.seq);
            }
            resolve(parseResult[method](raw));
          } catch (error) { reject(error); throw error; }
        }, fail: reject,
      });
      if (socket?.readyState === WebSocket.OPEN) {
        try { socket.send(frame); } catch { if (socket) disconnect(socket, true); }
      } else outbox.push(frame);
    });
  }

  open();
  return {
    call,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() {
      closed = true;
      recovery.close();
      clearTimeout(retryTimer); clearTimeout(connectTimer); stopHealth();
      if (socket) disconnect(socket, false);
      else failPending();
    },
  };
}
