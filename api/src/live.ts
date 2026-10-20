/**
 * The live view of a browser run: a relay between the viewer's websocket and
 * the run's noVNC desktop. Frames flow to the viewer untouched; what the
 * viewer sends passes the VNC gate, so input reaches the desktop only while
 * the conversation says the user holds the run (status paused).
 */
import type { Browsers } from "@remuse/browser";
import { WebSocket } from "ws";
import { vncGate } from "./vnc.ts";

export interface Live {
  browsers: Browsers;
  /** True while the user controls run `id`. */
  controlled(id: string): boolean;
}

/** noVNC admits only its own origin (NOVNC_ALLOWED_ORIGINS in compose.browsers.yaml). */
const nodeOrigin = "http://localhost:6080";

export function attach(viewer: WebSocket, id: string, live: Live): void {
  const target = live.browsers.vnc(id);
  if (!target) return viewer.close(4404, "no live browser for this run");
  const desktop = new WebSocket(target, ["binary"], { headers: { origin: nodeOrigin } });
  const gate = vncGate();
  const queued: Uint8Array[] = [];
  const end = (code: number, reason: string) => {
    if (viewer.readyState === WebSocket.OPEN) viewer.close(code, reason);
    if (desktop.readyState === WebSocket.OPEN || desktop.readyState === WebSocket.CONNECTING) desktop.terminate();
  };

  viewer.on("message", (data, binary) => {
    if (!binary || !(data instanceof Buffer)) return;
    const passed = gate.pass(data, live.controlled(id));
    if (passed === "close") return end(4400, "unexpected viewer message");
    if (passed.length === 0) return;
    if (desktop.readyState === WebSocket.OPEN) desktop.send(passed);
    else queued.push(passed);
  });
  desktop.on("open", () => queued.splice(0).forEach((part) => desktop.send(part)));
  desktop.on("message", (data, binary) => {
    if (viewer.readyState === WebSocket.OPEN) viewer.send(data, { binary });
  });
  desktop.on("close", () => end(4410, "the browser closed"));
  desktop.on("error", () => end(4502, "the browser is unreachable"));
  viewer.on("close", () => end(1000, "viewer left"));
}

/** A recent screenshot of the run's page for its card; null when it has no browser. */
export function thumbnail(live: Live, id: string): Promise<Uint8Array | null> {
  return live.browsers.screenshot(id);
}
