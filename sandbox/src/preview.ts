/** Loopback previews of web apps in the sandbox. Control routes never use this proxy. */
import { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse, request } from "node:http";
import type { Duplex } from "node:stream";
import { PORT } from "./protocol.ts";

interface Target { port: number; path: string }
const hop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function headers(source: IncomingHttpHeaders): IncomingHttpHeaders {
  const excluded = new Set([...hop, ...(source.connection ?? "").split(",").map((name) => name.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(source).filter(([name]) => !excluded.has(name.toLowerCase())));
}

function target(url: string, controlPort: number): Target | null {
  // Work on the raw request target: URL normalization must not turn a preview
  // path containing dot segments into one of the daemon's control endpoints.
  const match = /^\/preview\/([1-9][0-9]{0,4})(\/[^\r\n]*)?(\?[^\r\n]*)?$/.exec(url);
  if (!match) return null;
  const port = Number(match[1]);
  if (port > 65535 || port === PORT || port === controlPort) return null;
  const rest = match[2] ?? "/";
  return { port, path: rest + (match[3] ?? "") };
}

const previewPath = (url: string) => url === "/preview" || url.startsWith("/preview/") || url.startsWith("/preview?");
const reject = (res: ServerResponse, status: number, message: string) => void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: message }));

export function previewProxy(controlPort: () => number) {
  const sockets = new Set<Duplex>();
  const clients = new Set<ReturnType<typeof request>>();
  return {
    /** true: a preview request (valid or refused) was handled. */
    http(req: IncomingMessage, res: ServerResponse): boolean {
      if (!previewPath(req.url ?? "/")) return false;
      const to = target(req.url ?? "/", controlPort());
      if (!to) { reject(res, 400, "A preview needs an app port from 1 to 65535; the control daemon cannot be previewed."); return true; }
      const upstream = request({ hostname: "127.0.0.1", port: to.port, path: to.path, method: req.method, headers: { ...headers(req.headers), host: `127.0.0.1:${to.port}` } }, (answer) => {
        res.writeHead(answer.statusCode ?? 502, headers(answer.headers));
        answer.on("error", () => res.destroy());
        answer.pipe(res);
      });
      clients.add(upstream);
      upstream.once("close", () => clients.delete(upstream));
      upstream.once("error", () => { if (!res.headersSent) reject(res, 502, "The preview app cannot be reached."); else res.destroy(); });
      req.once("aborted", () => upstream.destroy());
      res.once("close", () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
      return true;
    },
    /** A raw WS relay preserves frames, subprotocols and compression negotiation. */
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if (!previewPath(req.url ?? "/")) return false;
      const to = target(req.url ?? "/", controlPort());
      if (!to || req.method !== "GET" || req.headers.upgrade?.toLowerCase() !== "websocket") {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return true;
      }
      sockets.add(socket);
      const upstream = request({ hostname: "127.0.0.1", port: to.port, path: to.path, method: "GET", headers: { ...headers(req.headers), host: `127.0.0.1:${to.port}`, connection: "Upgrade", upgrade: "websocket" } });
      clients.add(upstream);
      upstream.once("close", () => clients.delete(upstream));
      const stop = () => { sockets.delete(socket); upstream.destroy(); };
      socket.once("close", stop);
      socket.once("error", () => socket.destroy());
      upstream.once("error", () => { if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); });
      upstream.once("response", (answer) => {
        socket.write(`HTTP/1.1 ${answer.statusCode ?? 502} ${answer.statusMessage ?? ""}\r\nConnection: close\r\n\r\n`);
        answer.pipe(socket);
      });
      upstream.once("upgrade", (answer, remote, remoteHead) => {
        if (socket.destroyed) { remote.destroy(); return; }
        sockets.add(remote);
        socket.write(`HTTP/1.1 ${answer.statusCode ?? 101} ${answer.statusMessage ?? "Switching Protocols"}\r\n${answer.rawHeaders.map((value, i) => i % 2 === 0 ? `${value}: ` : `${value}\r\n`).join("")}\r\n`);
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        remote.once("error", () => socket.destroy());
        remote.once("close", () => { sockets.delete(remote); socket.destroy(); });
        socket.once("close", () => remote.destroy());
        socket.pipe(remote);
        remote.pipe(socket);
      });
      upstream.end();
      return true;
    },
    close() {
      for (const client of clients) client.destroy();
      for (const socket of sockets) socket.destroy();
      clients.clear(); sockets.clear();
    },
  };
}
