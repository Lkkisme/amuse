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

export async function attach(ws: WebSocket, id: string, live: Live): Promise<void> {
  const page = live.pool.page(id);
  if (!page) return ws.close(4404, "no live page for this run");
  const send = (frame: Frame) => {
    if (ws.readyState !== ws.OPEN) return;
    if (frame.kind === "frame") ws.send(frame.jpeg, { binary: true });
    else ws.send(JSON.stringify(frame));
  };
  const stop = await watch(page, send);
  ws.on("message", (data, binary) => {
    if (binary || !live.controlled(id)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return;
    }
    const input = Input.safeParse(raw);
    if (input.success) void replay(page, input.data).catch(() => {});
  });
  ws.on("close", () => void stop());
  page.once("close", () => ws.close(4410, "the run's page closed"));
}
