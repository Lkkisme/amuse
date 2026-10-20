/**
 * The network edge: an HTTP server — the built web app, /unlock, /thumb and
 * /connected — with two WebSocket routes: /rpc (one shared Session, one Peer
 * per socket) and /live?id=<run> (a run's live browser view). Requests
 * authenticate with the HttpOnly cookie from /unlock, a Bearer header, or
 * (cross-origin dev only) a token query parameter, compared in constant
 * time. Browsers may open the sockets only from this origin or an allowed
 * one; anything else is refused before the upgrade.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Session } from "@remuse/protocol";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { type Live, attach, thumbnail } from "./live.ts";
import { serve } from "./rpc.ts";
import { staticFiles } from "./static.ts";

export interface Options {
  session: Session;
  /** Live browser views at /live?id=<run>; off when absent. */
  live?: Live;
  /** Directory of the built web app to serve over HTTP; 404 for everything when absent. */
  web?: string;
  /** The user's browser is back from a connector's hosted page with a one-time key (GET /connected?key=…). */
  returned?: (key: string) => Promise<boolean>;
  /** Other origins whose pages may open the sockets (the dev web server); the server's own always may. */
  origins?: string[];
  token: string;
  port: number;
  host: string;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const cookieName = "remuse";

/** decodeURIComponent that never throws: a malformed value is simply no token. */
function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Every token a request carries: the HttpOnly cookie set by /unlock
 * (browsers; keeps it out of URLs and access logs), a Bearer header
 * (scripts), and — for the cross-origin dev setup only — the `token` query
 * parameter. Hostile input can only fail to match; it never throws.
 */
function presented(req: IncomingMessage, url: URL): string[] {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === cookieName)?.[1];
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  return [cookie === undefined ? null : decoded(cookie), bearer ?? null, url.searchParams.get("token")].filter((t) => t !== null);
}

const Unlock = z.object({ token: z.string().min(1).max(512) });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Target = { kind: "rpc" } | { kind: "live"; id: string; live: Live };

/** A running server: where it listens, and how to stop it (sockets included). */
export interface Listening {
  port: number;
  close(): Promise<void>;
}

export function listen({ session, live, web, returned, origins = [], token, port, host }: Options): Promise<Listening> {
  const route = (url: URL): Target | null => {
    if (url.pathname === "/rpc") return { kind: "rpc" };
    const id = url.searchParams.get("id");
    return url.pathname === "/live" && live && id ? { kind: "live", id, live } : null;
  };
  const files = web ? staticFiles(web) : null;
  const allowed = (req: IncomingMessage, url: URL) => presented(req, url).some((offered) => sameToken(offered, token));

  /** POST /unlock {token} → sets the HttpOnly session cookie; GET /unlock → 204 when this browser is unlocked. */
  const unlock = async (req: IncomingMessage, url: URL, res: ServerResponse) => {
    if (req.method === "GET") return void res.writeHead(allowed(req, url) ? 204 : 401).end();
    if (req.method !== "POST") return void res.writeHead(405).end();
    let body = "";
    for await (const chunk of req) {
      body += String(chunk);
      if (body.length > 4096) return void res.writeHead(413).end();
    }
    const offered = Unlock.safeParse(parseJson(body));
    if (!offered.success || !sameToken(offered.data.token, token)) return void res.writeHead(401).end();
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    res.writeHead(204, {
      "set-cookie": `${cookieName}=${encodeURIComponent(offered.data.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`,
    });
    res.end();
  };

  /** GET /thumb?id=<run> → the run's page as a small JPEG, for its card. */
  const thumb = async (req: IncomingMessage, url: URL, res: ServerResponse) => {
    const id = url.searchParams.get("id");
    const image = live && id && allowed(req, url) ? await thumbnail(live, id) : null;
    if (!image) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(image);
  };
  /** GET /connected?key=… → check the connection now, then tell the user they can go back. */
  const back = async (url: URL, res: ServerResponse) => {
    const key = url.searchParams.get("key");
    const connected = key && returned ? await returned(key) : false;
    const message = connected ? "Connected — you can close this tab and go back to Muse." : "Thanks — you can close this tab and go back to Muse.";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Muse</title><p style="font:16px system-ui;text-align:center;margin-top:30vh">${message}</p><script>setTimeout(()=>window.close(),1500)</script>`);
  };
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const handled =
      url.pathname === "/unlock" ? unlock(req, url, res)
      : url.pathname === "/thumb" ? thumb(req, url, res)
      : url.pathname === "/connected" ? back(url, res)
      : files ? files(req, res)
      : Promise.resolve(void res.writeHead(404).end());
    handled.catch(() => res.writeHead(500).end());
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    const target = route(url);
    // a page elsewhere (even a sibling subdomain carrying the cookie) may not open our sockets
    const origin = req.headers.origin;
    const foreign = origin !== undefined && !origins.includes(origin) && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`;
    if (!target || foreign || !allowed(req, url)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (target.kind === "live") return void attach(ws, target.id, target.live).catch(() => ws.close(4500, "the live view failed"));
      const peer = serve(session, (frame) => ws.send(frame));
      ws.on("message", (data, binary) => void (binary ? undefined : peer.receive(data.toString())));
      ws.on("close", peer.close);
    });
  });

  /** Upgraded sockets are no longer the HTTP server's to close: end them first, then stop listening. */
  const close = () =>
    new Promise<void>((resolve) => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      http.closeAllConnections();
      http.close(() => resolve());
    });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      http.off("error", reject);
      const address = http.address();
      resolve({ port: address !== null && typeof address === "object" ? address.port : port, close });
    });
  });
}
