/**
 * Where the conversation lives:
 *   demo    no server configured: the real core runs in the browser with scripted ports
 *   server  VITE_REMUSE_URL (dev: full ws URL with token), or the same origin the app was
 *           served from (VITE_REMUSE_MODE=same-origin, the Docker build) with a stored token
 *   locked  same-origin, but no token on this device yet
 * The token arrives once as #token=… (then stored and wiped from the address bar) or is typed in.
 */
const tokenKey = "remuse.token";

export type Connection = { kind: "demo" } | { kind: "locked" } | { kind: "server"; rpc: string; live: (id: string) => string };

function server(rpc: string): Connection {
  return {
    kind: "server",
    rpc,
    live: (id) => {
      const url = new URL(rpc);
      url.pathname = "/live";
      url.searchParams.set("id", id);
      return url.toString();
    },
  };
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
