/**
 * The network edge: an HTTP server (the built web app, and /thumb?id=<run>
 * for card thumbnails) with two WebSocket routes: /rpc (one
 * shared Session, one Peer per socket) and /live?id=<run> (a run's live
 * browser view). The access token rides in
 * the query string (browsers cannot set WebSocket headers) and is compared
 * in constant time; anything else is refused before the upgrade.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { type Server, type ServerResponse, createServer } from "node:http";
import type { Session } from "@remuse/protocol";
import { WebSocketServer } from "ws";
import { type Live, attach, thumbnail } from "./live.ts";
import { serve } from "./rpc.ts";
import { staticFiles } from "./static.ts";

export interface Options {
  session: Session;
  /** Live browser views at /live?id=<run>; off when absent. */
  live?: Live;
  /** Directory of the built web app to serve over HTTP; 404 for everything when absent. */
  web?: string;
  token: string;
  port: number;
  host: string;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

type Target = { kind: "rpc" } | { kind: "live"; id: string; live: Live };

export function listen({ session, live, web, token, port, host }: Options): Promise<Server> {
  const route = (url: URL): Target | null => {
    if (url.pathname === "/rpc") return { kind: "rpc" };
    const id = url.searchParams.get("id");
    return url.pathname === "/live" && live && id ? { kind: "live", id, live } : null;
  };
  const files = web ? staticFiles(web) : null;
  /** GET /thumb?id=<run>&token=… → the run's page as a small JPEG, for its card. */
  const thumb = async (url: URL, res: ServerResponse) => {
    const id = url.searchParams.get("id");
    const image = live && id && sameToken(url.searchParams.get("token") ?? "", token) ? await thumbnail(live, id) : null;
    if (!image) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(image);
  };
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const handled = url.pathname === "/thumb" ? thumb(url, res) : files ? files(req, res) : Promise.resolve(void res.writeHead(404).end());
    handled.catch(() => res.writeHead(500).end());
  });
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
