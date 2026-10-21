/**
 * The network edge: an HTTP server — the built web app, the way in (/setup,
 * /unlock, /lock, /password), /thumb, /files (uploads and the files themselves)
 * and /connected — with two WebSocket routes: /rpc (one shared Session, one
 * Peer per socket) and /live?id=<run> (a run's live browser view). Requests
 * authenticate with the HttpOnly session cookie the master password opens
 * (access.ts). Browsers may open the sockets, and post to the way in, only
 * from this origin; anything else is refused.
 */
import { createReadStream, statSync } from "node:fs";
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import type { Session } from "@remuse/protocol";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { type Access, PasswordRejected } from "./access.ts";
import { type FileStore, shownInline } from "./workspace.ts";
import { type Live, attach, thumbnail } from "./live.ts";
import { serve } from "./rpc.ts";
import { staticFiles } from "./static.ts";

export interface Options {
  session: Session;
  /** Live browser views at /live?id=<run>; off when absent. */
  live?: Live;
  /** The user's files: POST /files uploads one, GET /files/<id> serves it; off when absent. */
  files?: FileStore;
  /** Directory of the built web app to serve over HTTP; 404 for everything when absent. */
  web?: string;
  /** The user's browser is back from a connector's hosted page with a one-time key (GET /connected?key=…). */
  returned?: (key: string) => Promise<boolean>;
  access: Access;
  port: number;
  host: string;
}

const cookieName = "remuse";

/** decodeURIComponent that never throws: a malformed value is simply no session. */
function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The session a request carries in its cookie, if any. Hostile input can only fail to match; it never throws. */
function presented(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === cookieName)?.[1];
  return cookie === undefined ? null : decoded(cookie);
}

const Password = z.string().min(1).max(1024);
const SetUp = z.object({ password: Password });
const Change = z.object({ current: Password, next: Password });

/** Wrong passwords a client may try in a window before it has to wait. */
const TRIES = 10;
const TRY_WINDOW_MS = 15 * 60_000;

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

export function listen({
  session,
  live,
  files: uploads,
  web,
  returned,
  access,
  port,
  host,
}: Options): Promise<Listening> {
  const route = (url: URL): Target | null => {
    if (url.pathname === "/rpc") return { kind: "rpc" };
    const id = url.searchParams.get("id");
    return url.pathname === "/live" && live && id
      ? { kind: "live", id, live }
      : null;
  };
  const files = web ? staticFiles(web) : null;
  /** a request with no session carries "", which is never one */
  const allowed = (req: IncomingMessage) => access.valid(presented(req) ?? "");
  /** A page of this origin (or no page: a script); a page elsewhere may not. */
  const ours = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    return (
      origin === undefined ||
      origin === `http://${req.headers.host}` ||
      origin === `https://${req.headers.host}`
    );
  };

  /** Wrong passwords lately, by client address. */
  const tries = new Map<string, number[]>();
  const recent = (req: IncomingMessage) => {
    const now = Date.now();
    const key = req.socket.remoteAddress ?? "";
    const kept = (tries.get(key) ?? []).filter((t) => now - t < TRY_WINDOW_MS);
    tries.set(key, kept);
    return { count: kept.length, miss: () => kept.push(now) };
  };

  const cookie = (req: IncomingMessage, session: string | null) => {
    const secure =
      req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return session === null
      ? `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
      : `${cookieName}=${encodeURIComponent(session)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`;
  };
  const body = async (req: IncomingMessage): Promise<unknown> => {
    let text = "";
    for await (const chunk of req) {
      text += String(chunk);
      if (text.length > 4096) return null;
    }
    return parseJson(text);
  };
  const json = (res: ServerResponse, status: number, value: unknown) =>
    void res
      .writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(JSON.stringify(value));

  /**
   * The way in. GET /unlock → 204 when this browser is in, else 401 with
   * whether the password is set yet. POST /setup {password} sets it (the first
   * time only); POST /unlock {password} opens a session; POST /lock ends this
   * one; POST /password {current, next} changes it, ending every other session.
   * Posts come as JSON from this origin only, so no other page can send them.
   */
  const way = async (req: IncomingMessage, url: URL, res: ServerResponse) => {
    if (url.pathname === "/unlock" && req.method === "GET")
      return allowed(req)
        ? void res.writeHead(204, { "cache-control": "no-store" }).end()
        : json(res, 401, { ready: access.ready() });
    if (req.method !== "POST") return void res.writeHead(405).end();
    if (
      !ours(req) ||
      !String(req.headers["content-type"] ?? "").startsWith("application/json")
    )
      return void res.writeHead(403).end();
    if (url.pathname === "/lock") {
      const session = presented(req);
      if (session !== null) access.logout(session);
      return void res.writeHead(204, { "set-cookie": cookie(req, null) }).end();
    }
    const tried = recent(req);
    if (tried.count >= TRIES)
      return json(res, 429, {
        reason: "Too many wrong passwords. Try again in a few minutes.",
      });
    try {
      if (url.pathname === "/setup") {
        const given = SetUp.safeParse(await body(req));
        if (!given.success) return void res.writeHead(400).end();
        return void res
          .writeHead(204, {
            "set-cookie": cookie(req, await access.setup(given.data.password)),
          })
          .end();
      }
      if (url.pathname === "/unlock") {
        const given = SetUp.safeParse(await body(req));
        if (!given.success) return void res.writeHead(400).end();
        const session = await access.login(given.data.password);
        if (session === null) {
          tried.miss();
          return json(res, 401, { reason: "That is not the password." });
        }
        return void res
          .writeHead(204, { "set-cookie": cookie(req, session) })
          .end();
      }
      if (url.pathname === "/password") {
        if (!allowed(req)) return void res.writeHead(401).end();
        const given = Change.safeParse(await body(req));
        if (!given.success) return void res.writeHead(400).end();
        const session = await access.change(
          given.data.current,
          given.data.next,
        );
        if (session === null) {
          tried.miss();
          return json(res, 401, {
            reason: "That is not the current password.",
          });
        }
        return void res
          .writeHead(204, { "set-cookie": cookie(req, session) })
          .end();
      }
    } catch (error) {
      if (error instanceof PasswordRejected)
        return json(res, 400, { reason: error.message });
      throw error;
    }
    return void res.writeHead(404).end();
  };

  /** GET /thumb?id=<run> → a screenshot of the run's page, for its card. */
  const thumb = async (req: IncomingMessage, url: URL, res: ServerResponse) => {
    const id = url.searchParams.get("id");
    const image = live && id && allowed(req) ? await thumbnail(live, id) : null;
    if (!image) return void res.writeHead(404).end();
    res
      .writeHead(200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      })
      .end(image);
  };
  /**
   * POST /files (the bytes as the body; the name in X-File-Name, URI-encoded; the
   * type in Content-Type) → the Attachment, to send with a message.
   * GET /files/<id> → the file. Images and videos are shown in the page; anything
   * else only downloads. Nothing served runs: no sniffing, and a sandbox for
   * whatever is opened on its own.
   */
  const file = async (req: IncomingMessage, url: URL, res: ServerResponse) => {
    if (!uploads || !allowed(req))
      return void res.writeHead(uploads ? 401 : 404).end();
    if (url.pathname === "/files" && req.method === "POST") {
      const name = decoded(String(req.headers["x-file-name"] ?? "")) ?? "";
      const type =
        String(req.headers["content-type"] ?? "")
          .split(";")[0]
          ?.trim() ?? "";
      const saved = await uploads.save(name, type, req);
      if (!saved) return void res.writeHead(413).end();
      return void res
        .writeHead(201, { "content-type": "application/json" })
        .end(JSON.stringify(saved));
    }
    const found =
      req.method === "GET"
        ? uploads.find(url.pathname.slice("/files/".length))
        : null;
    if (!found) return void res.writeHead(404).end();
    const { attachment, file: path } = found;
    const size = statSync(path).size; // as it is now (Muse may have rewritten it)
    const inline = shownInline(attachment.type);
    const headers = {
      "content-type": inline ? attachment.type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, max-age=31536000, immutable",
      "accept-ranges": "bytes",
    };
    // a video seeks by asking for a range of it
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && size > 0) {
      const start = range[1]
        ? Number(range[1])
        : Math.max(0, size - Number(range[2]));
      const end =
        range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size)
        return void res
          .writeHead(416, { "content-range": `bytes */${size}` })
          .end();
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": end - start + 1,
      });
      return void createReadStream(path, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": size });
    createReadStream(path).pipe(res);
  };
  /** GET /connected?key=… → check the connection now, then tell the user they can go back. */
  const back = async (url: URL, res: ServerResponse) => {
    const key = url.searchParams.get("key");
    const connected = key && returned ? await returned(key) : false;
    const message = connected
      ? "Connected — you can close this tab and go back to Muse."
      : "Thanks — you can close this tab and go back to Muse.";
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Muse</title><p style="font:16px system-ui;text-align:center;margin-top:30vh">${message}</p><script>setTimeout(()=>window.close(),1500)</script>`,
    );
  };
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const handled = ["/setup", "/unlock", "/lock", "/password"].includes(
      url.pathname,
    )
      ? way(req, url, res)
      : url.pathname === "/thumb"
        ? thumb(req, url, res)
        : url.pathname === "/files" || url.pathname.startsWith("/files/")
          ? file(req, url, res)
          : url.pathname === "/connected"
            ? back(url, res)
            : files
              ? files(req, res)
              : Promise.resolve(void res.writeHead(404).end());
    handled.catch(() => res.writeHead(500).end());
  });
  // noVNC viewers ask for the "binary" subprotocol; the RPC client asks for none
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (offered) => (offered.has("binary") ? "binary" : false),
  });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    const target = route(url);
    // a page elsewhere (even a sibling subdomain carrying the cookie) may not open our sockets
    if (!target || !ours(req) || !allowed(req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (target.kind === "live") return attach(ws, target.id, target.live);
      const peer = serve(session, (frame) => ws.send(frame));
      ws.on(
        "message",
        (data, binary) =>
          void (binary ? undefined : peer.receive(data.toString())),
      );
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
      resolve({
        port:
          address !== null && typeof address === "object" ? address.port : port,
        close,
      });
    });
  });
}
