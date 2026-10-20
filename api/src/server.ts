/**
 * The network edge: an HTTP server whose only route is the WebSocket at
 * /rpc. One shared Session; one Peer per socket. The access token rides in
 * the query string (browsers cannot set WebSocket headers) and is compared
 * in constant time; anything else is refused before the upgrade.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { Session } from "@remuse/protocol";
import { WebSocketServer } from "ws";
import { serve } from "./rpc.ts";

export interface Options {
  session: Session;
  token: string;
  port: number;
  host: string;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function listen({ session, token, port, host }: Options): Promise<Server> {
  const http = createServer((_, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== "/rpc" || !sameToken(url.searchParams.get("token") ?? "", token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
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
