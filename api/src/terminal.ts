/**
 * A terminal in the sandbox, for the user: a relay between the viewer's
 * websocket and the sandbox daemon's, which shows herdr's own interface (the
 * terminals Amuse and the user share). Bytes go both ways untouched; of the
 * viewer's text messages only a resize passes. How it ended reaches the
 * viewer as a code, in this server's words, never the daemon's. What the
 * sandbox sends is held to a bound: no frame larger than a screenful or so,
 * and while the viewer is slow to take it (a phone on a weak line), the
 * sandbox is not read; a viewer that takes nothing for long is let go.
 */
import { TerminalMessage } from "@amuse/sandbox";
import { type RawData, WebSocket } from "ws";

/** Why a terminal closed, as the viewer is told. */
export const TERMINAL_CLOSED = {
  /** the terminal ended (herdr's interface was quit, or detached) */
  ended: 1000,
  /** there is no sandbox, or it has no terminals */
  none: 4404,
  /** too many are open */
  full: 4429,
  /** the sandbox cannot be reached, or its terminals are not running */
  away: 4503,
} satisfies Record<string, number>;

/** The largest frame taken from the sandbox (its screen comes in pieces far smaller). */
const LARGEST_FRAME = 256 * 1024;
/** Screen bytes waiting for the viewer before the sandbox is no longer read, before it is read again, and before the viewer is let go. */
const BACKLOG = 1024 ** 2;
const DRAINED = 256 * 1024;
const STUCK = 8 * 1024 ** 2;
const HANDSHAKE_MS = 10_000;

const bytes = (data: RawData) => (Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data));

export function attachTerminal(viewer: WebSocket, target: string): void {
  const terminal = new WebSocket(target, { maxPayload: LARGEST_FRAME, handshakeTimeout: HANDSHAKE_MS });
  const queued: { data: Buffer | string; binary: boolean }[] = [];
  const end = (code: number, reason: string) => {
    if (viewer.readyState === WebSocket.OPEN) viewer.close(code, reason);
    if (terminal.readyState === WebSocket.OPEN || terminal.readyState === WebSocket.CONNECTING) terminal.terminate();
  };
  const pass = (data: Buffer | string, binary: boolean) => {
    if (terminal.readyState === WebSocket.OPEN) terminal.send(data, { binary });
    else queued.push({ data, binary });
  };

  viewer.on("message", (data, binary) => {
    if (binary) return pass(bytes(data), true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes(data).toString("utf8"));
    } catch {
      return;
    }
    const message = TerminalMessage.safeParse(parsed);
    if (message.success) pass(JSON.stringify(message.data), false);
  });
  terminal.on("open", () => queued.splice(0).forEach(({ data, binary }) => terminal.send(data, { binary })));
  terminal.on("message", (data, binary) => {
    if (!binary || viewer.readyState !== WebSocket.OPEN) return;
    if (viewer.bufferedAmount > STUCK) return end(TERMINAL_CLOSED.ended, "the viewer is not keeping up");
    viewer.send(bytes(data), { binary: true }, () => {
      if (terminal.isPaused && viewer.bufferedAmount < DRAINED) terminal.resume();
    });
    if (viewer.bufferedAmount > BACKLOG) terminal.pause();
  });
  terminal.on("close", (code) =>
    code === TERMINAL_CLOSED.none
      ? end(TERMINAL_CLOSED.none, "no terminals")
      : code === TERMINAL_CLOSED.full
        ? end(TERMINAL_CLOSED.full, "too many terminals")
        : code === TERMINAL_CLOSED.away
          ? end(TERMINAL_CLOSED.away, "terminals not running")
          : end(TERMINAL_CLOSED.ended, "the terminal ended"),
  );
  terminal.on("error", () => end(TERMINAL_CLOSED.away, "the sandbox is unreachable"));
  viewer.on("close", () => end(1000, "viewer left"));
}
