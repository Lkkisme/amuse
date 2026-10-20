/**
 * One live view: frames from the run's page to the socket, input from the
 * socket to the page — but only while the conversation says the user holds
 * the run (status paused). Bad input is dropped, never applied.
 */
import { type Frame, type Pool, replay, watch } from "@remuse/browser";
import { Input } from "@remuse/protocol";
import type { WebSocket } from "ws";

export interface Live {
  pool: Pool;
  /** True while the user controls run `id`. */
  controlled(id: string): boolean;
}

/** Above this many unsent bytes on the socket, frames are dropped (see watch). */
const maxBuffered = 1 << 20;

export async function attach(ws: WebSocket, id: string, live: Live): Promise<void> {
  const page = live.pool.page(id);
  if (!page) return ws.close(4404, "no live page for this run");
  const send = (frame: Frame) => {
    if (ws.readyState !== ws.OPEN) return;
    if (frame.kind === "frame") ws.send(frame.jpeg, { binary: true });
    else ws.send(JSON.stringify(frame));
  };

  // input is replayed strictly in order: a pointer down is a move then a press, nothing may land between
  let inputs: Promise<void> = Promise.resolve();
  ws.on("message", (data, binary) => {
    if (binary || !live.controlled(id)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return;
    }
    const input = Input.safeParse(raw);
    if (input.success) inputs = inputs.then(() => replay(page, input.data)).catch(() => {});
  });

  const pageClosed = () => ws.close(4410, "the run's page closed");
  page.once("close", pageClosed);
  let stop: (() => Promise<void>) | null = null;
  ws.on("close", () => {
    page.off("close", pageClosed);
    void stop?.();
  });

  try {
    stop = await watch(page, send, () => ws.bufferedAmount < maxBuffered);
  } catch {
    return ws.close(4500, "the live view could not start");
  }
  if (ws.readyState !== ws.OPEN) await stop(); // the viewer left while it was starting
}

/** A small, recent JPEG of the run's page for its card; null when it has no live page. */
export async function thumbnail(live: Live, id: string): Promise<Buffer | null> {
  const page = live.pool.page(id);
  return page ? page.screenshot({ type: "jpeg", quality: 45, timeout: 5_000 }).catch(() => null) : null;
}
