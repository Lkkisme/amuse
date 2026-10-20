/**
 * The network edge: an HTTP server with two WebSocket routes: /rpc (one
 * shared Session, one Peer per socket) and /live?id=<run> (a run's live
 * browser view). The access token rides in
 * the query string (browsers cannot set WebSocket headers) and is compared
 * in constant time; anything else is refused before the upgrade.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { Session } from "@remuse/protocol";
import { WebSocketServer } from "ws";
import { type Live, attach } from "./live.ts";
import { serve } from "./rpc.ts";

export interface Options {
  session: Session;
  /** Live browser views at /live?id=<run>; off when absent. */
  live?: Live;
  token: string;
  port: number;
  host: string;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

type Target = { kind: "rpc" } | { kind: "live"; id: string; live: Live };

export function listen({ session, live, token, port, host }: Options): Promise<Server> {
  const route = (url: URL): Target | null => {
    if (url.pathname === "/rpc") return { kind: "rpc" };
    const id = url.searchParams.get("id");
    return url.pathname === "/live" && live && id ? { kind: "live", id, live } : null;
  };
  const http = createServer((_, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    const target = route(url);
    if (!target || !sameToken(url.searchParams.get("token") ?? "", token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (target.kind === "live") return void attach(ws, target.id, target.live);
      const peer = serve(session, (frame) => ws.send(frame));
      ws.on("message", (data, binary) => void (binary ? undefined : peer.receive(data.toString())));
      ws.on("close", peer.close);
    });
  });

  http.on("close", () => wss.close());
  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      http.off("error", reject);
      resolve(http);
    });
  });
}
