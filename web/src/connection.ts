/**
 * Where the conversation lives:
 *   demo    no server configured: the real core runs in the browser with scripted ports
 *   server  VITE_REMUSE_URL (dev: full ws URL with token), or the same origin the app was
 *           served from (VITE_REMUSE_MODE=same-origin, the Docker build) with a stored token
 *   locked  same-origin, but no token on this device yet
 * The token arrives once as #token=… (then stored and wiped from the address bar) or is typed in.
 */
const tokenKey = "remuse.token";

export type Connection =
  | { kind: "demo" }
  | { kind: "locked" }
  | { kind: "server"; rpc: string; live: (id: string) => string; thumb: (id: string) => string };

/** A route next to /rpc on the same server, for a run id (ws for /live, http for /thumb). */
function route(rpc: string, path: string, id: string, http: boolean) {
  const url = new URL(rpc);
  url.pathname = path;
  url.searchParams.set("id", id);
  if (http) url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.toString();
}

function server(rpc: string): Connection {
  return { kind: "server", rpc, live: (id) => route(rpc, "/live", id, false), thumb: (id) => route(rpc, "/thumb", id, true) };
}

export function connection(): Connection {
  const explicit = import.meta.env["VITE_REMUSE_URL"];
  if (typeof explicit === "string" && explicit) return server(explicit);
  if (import.meta.env["VITE_REMUSE_MODE"] !== "same-origin") return { kind: "demo" };

  const fromLink = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromLink) {
    localStorage.setItem(tokenKey, fromLink);
    history.replaceState(null, "", location.pathname + location.search);
  }
  const token = localStorage.getItem(tokenKey);
  if (!token) return { kind: "locked" };
  const rpc = new URL("/rpc", location.href);
  rpc.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  rpc.searchParams.set("token", token);
  return server(rpc.toString());
}

export function unlock(token: string) {
  localStorage.setItem(tokenKey, token.trim());
  location.replace(location.pathname + location.search); // reload without the token in the address bar
}
