/**
 * The size of a node's desktop. The agent works at one standard size; while
 * the user holds a run, the desktop takes the shape of their screen, so the
 * page fills it — never smaller than a desktop page wants, never huge.
 *
 * The server sets it itself, over the node's VNC socket: a bare RFB client
 * that says it understands desktop sizes (TigerVNC ignores SetDesktopSize
 * from one that does not) and asks for one.
 */
import { WebSocket } from "ws";

export type Size = { width: number; height: number };

/** What the agent sees (4:3: full desktop layouts, and big enough on a phone). */
export const standard: Size = { width: 1024, height: 768 };

/** The short side never goes under this (pages turn cramped), the long side never over that. */
const MIN_SHORT = 720;
const MAX_LONG = 1920;

/** A desktop of the viewer's shape: scaled up until its short side is MIN_SHORT, down if its long side passes MAX_LONG. */
export function fitted(viewer: Size): Size {
  const short = Math.min(viewer.width, viewer.height);
  const long = Math.max(viewer.width, viewer.height);
  const k = Math.min(Math.max(1, MIN_SHORT / short), MAX_LONG / long);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(viewer.width), height: even(viewer.height) };
}

/** noVNC on a node admits only its own origin (NOVNC_ALLOWED_ORIGINS in compose.browsers.yaml). */
export const nodeOrigin = "http://localhost:6080";

/** Set the desktop behind `vnc` (the node's websockify URL) to `size`. Resolves once the server has taken it. */
export function resize(vnc: string, size: Size, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(vnc, ["binary"], { headers: { origin: nodeOrigin } });
    let buffer = new Uint8Array(0);
    let waiting: { n: number; take: (bytes: Uint8Array) => void } | null = null;
    const timer = setTimeout(() => fail(new Error("the desktop did not answer")), timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      ws.close();
    };
    const fail = (error: Error) => {
      finish();
      reject(error);
    };
    const pump = () => {
      if (!waiting || buffer.length < waiting.n) return;
      const { n, take } = waiting;
      waiting = null;
      const bytes = buffer.slice(0, n);
      buffer = buffer.slice(n);
      take(bytes);
    };
    const read = (n: number) =>
      new Promise<Uint8Array>((take) => {
        waiting = { n, take };
        pump();
      });
    const u16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
    const u32 = (b: Uint8Array, at: number) => (u16(b, at) * 0x10000 + u16(b, at + 2)) >>> 0;

    ws.on("message", (data: Buffer) => {
      const joined = new Uint8Array(buffer.length + data.length);
      joined.set(buffer);
      joined.set(data, buffer.length);
      buffer = joined;
      pump();
    });
    ws.on("error", () => fail(new Error("the desktop is unreachable")));
    ws.on("open", () => {
      void (async () => {
        await read(12); // "RFB 003.008\n"
        ws.send(new TextEncoder().encode("RFB 003.008\n"));
        const types = await read(1).then((n) => read(n[0] ?? 0));
        if (!types.includes(1)) throw new Error("the desktop asks for a password");
        ws.send(Uint8Array.of(1)); // security: None
        if (u32(await read(4), 0) !== 0) throw new Error("the desktop refused the connection");
        ws.send(Uint8Array.of(1)); // ClientInit: shared, leave other viewers be
        const init = await read(24);
        await read(u32(init, 20)); // the desktop's name

        const message = new Uint8Array(32);
        const view = new DataView(message.buffer);
        // SetEncodings [ExtendedDesktopSize]
        view.setUint8(0, 2);
        view.setUint16(2, 1);
        view.setInt32(4, -308);
        // SetDesktopSize: one screen covering it all
        view.setUint8(8, 251);
        view.setUint16(10, size.width);
        view.setUint16(12, size.height);
        view.setUint8(14, 1);
        view.setUint16(24, size.width);
        view.setUint16(26, size.height);
        ws.send(message);
        // the server answers in order: an update after the request means the resize was handled first
        ws.send(Uint8Array.of(3, 1, 0, 0, 0, 0, 0, 1, 0, 1)); // FramebufferUpdateRequest, incremental, 1×1
        await read(1);
      })().then(
        () => {
          finish();
          resolve();
        },
        (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}
