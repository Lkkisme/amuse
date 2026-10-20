/**
 * Where the conversation lives:
 *   demo    no server configured: the real core runs in the browser with scripted ports
 *   server  VITE_REMUSE_URL (dev: full ws URL with token), or the same origin the app was
 *           served from (VITE_REMUSE_MODE=same-origin, the Docker build) with a stored token
 *   locked  same-origin, but this browser is not unlocked yet
 * The token arrives once as #token=… (wiped from the address bar at once) or is typed in; the
 * server turns it into an HttpOnly cookie, so scripts, URLs and logs never see it again.
 */

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

const post = (token: string) =>
  fetch("/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).then((r) => r.ok);

export async function connection(): Promise<Connection> {
  const explicit = import.meta.env["VITE_REMUSE_URL"];
  if (typeof explicit === "string" && explicit) return server(explicit);
  if (import.meta.env["VITE_REMUSE_MODE"] !== "same-origin") return { kind: "demo" };

  // same origin: the token becomes an HttpOnly cookie and never sits in a URL or in page storage
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromLink) {
    history.replaceState(null, "", location.pathname + location.search);
    await post(fromLink).catch(() => false);
  }
  const unlocked = await fetch("/unlock").then((r) => r.status === 204, () => false);
  if (!unlocked) return { kind: "locked" };
  const rpc = new URL("/rpc", location.href);
  rpc.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return server(rpc.toString());
}

/** Unlock this browser; reloads on success, false when the token is wrong. */
export async function unlock(token: string): Promise<boolean> {
  const ok = await post(token.trim()).catch(() => false);
  if (ok) location.replace(location.pathname + location.search);
  return ok;
}
