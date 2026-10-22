/**
 * A terminal relayed to a websocket: a command (herdr's interface) in a
 * pseudo-terminal of its own (terminal_relay.py), its screen sent to the
 * viewer as it comes and what the viewer types passed in. The viewer's size
 * follows its window. When either side goes, so does the other: a viewer that
 * leaves hangs the terminal up (herdr's interface detaches; what runs in herdr
 * goes on), and a terminal that ends closes the socket.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Writable } from "node:stream";
import { type RawData, WebSocket } from "ws";
import { TerminalMessage } from "./protocol.ts";

const RELAY = join(import.meta.dirname, "terminal_relay.py");
/** Screen bytes waiting to go out to a slow viewer before the terminal is held back, and when it is let go again. */
const BACKLOG = 1024 ** 2;
const DRAINED = 256 * 1024;
/** How long a terminal whose viewer left is given to end before it is killed (ms). */
const GRACE_MS = 3_000;

export interface Terminal {
  /** its process group */
  pid: number | undefined;
  /** once it has ended */
  ended: Promise<void>;
  /** a signal to its whole group */
  signal(name: NodeJS.Signals): void;
}

export function relayTerminal(
  ws: WebSocket,
  { command, cols, rows, cwd, env, user }: { command: string[]; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; user?: { uid: number; gid: number } },
): Terminal {
  const child = spawn("python3", ["-I", RELAY, String(cols), String(rows), ...command], {
    cwd,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "ignore", "pipe"],
    ...(user ? { uid: user.uid, gid: user.gid } : {}),
  });
  const group = child.pid;
  const signal = (name: NodeJS.Signals) => {
    if (group === undefined) return;
    try {
      process.kill(-group, name);
    } catch {
      // the group is gone already
    }
  };
  const sizes = child.stdio[3];
  const typed = child.stdin;
  const screen = child.stdout;

  screen?.on("data", (bytes: Buffer) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(bytes, { binary: true }, () => {
      if (screen.isPaused() && ws.bufferedAmount < DRAINED) screen.resume();
    });
    if (ws.bufferedAmount > BACKLOG) screen.pause();
  });
  // writes after the terminal has ended go nowhere
  for (const stream of [typed, sizes]) stream?.on("error", () => {});

  ws.on("message", (data: RawData, binary: boolean) => {
    const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (binary) return void typed?.write(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      return;
    }
    const message = TerminalMessage.safeParse(parsed);
    if (message.success && sizes instanceof Writable && sizes.writable) sizes.write(`${message.data.cols} ${message.data.rows}\n`);
  });

  const ended = new Promise<void>((done) => {
    child.once("error", () => done());
    child.once("exit", () => done());
  });
  void ended.then(() => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, "the terminal ended");
  });
  ws.on("close", () => {
    // the relay hangs its terminal up when its input ends; one that does not end is killed
    typed?.end();
    const force = setTimeout(() => signal("SIGKILL"), GRACE_MS);
    void ended.then(() => clearTimeout(force));
  });
  return { pid: group, ended, signal };
}
