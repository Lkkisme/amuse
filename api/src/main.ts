/**
 * Dev entry: the core host with the demo ports, served on 127.0.0.1.
 *   REMUSE_TOKEN  required access token (refuses to start without one)
 *   REMUSE_PORT   default 8797
 *   REMUSE_HOST   default 127.0.0.1
 *   REMUSE_PI_MODEL, REMUSE_PI_AUTH  when both are set, the agent is Pi (provider/model-id,
 *                 Pi auth file)
 *   REMUSE_COMPOSIO_KEY_FILE  file holding a Composio developer key (ak_…): connectors go
 *                 through Composio; read once, never logged
 *   REMUSE_JOURNAL  JSONL file the event log lives in (survives restarts); in memory if unset
 *   REMUSE_BROWSER=chromium  browser runs open real pages (headless Chromium) with live views
 *                 at /live; scripted otherwise
 *   REMUSE_BROWSER_STATE  file keeping browser logins between runs (cookies; mode 600)
 *   REMUSE_PUBLIC_URL  this server's address as the user's browser reaches it (http://host:port);
 *                 lets connectors send the user straight back for an instant "connected"
 *   REMUSE_WEB    directory of the built web app to serve (same origin as /rpc and /live)
 */
import { readFileSync } from "node:fs";
import { composio, composioApps, composioConnector } from "@remuse/composio";
import { fileJournal } from "./journal.ts";
import { browserPorts, pool } from "@remuse/browser";
import { type Ports, createHost, realTimers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import { type State, apply, empty } from "@remuse/protocol";
import { piAgent, piBrowserAgent, untrustedRule } from "@remuse/pi";
import { listen } from "./server.ts";

const token = process.env["REMUSE_TOKEN"];
if (!token) {
  console.error("REMUSE_TOKEN is not set; refusing to start.");
  process.exit(1);
}
const port = Number(process.env["REMUSE_PORT"] ?? 8797);
const host = process.env["REMUSE_HOST"] ?? "127.0.0.1";

const model = process.env["REMUSE_PI_MODEL"];
const authPath = process.env["REMUSE_PI_AUTH"];
const system = [
  "You are Muse, a personal assistant in a chat app. Answer in the user's language, briefly and warmly. Use markdown only when it helps.",
  "When a request needs a website, start a browser task with `browse` and tell the user it is running; it continues in the background and they can watch or take over.",
  "When a request needs one of the user's apps (mail, calendar, sheets, ...), ask with `request_connection` instead of guessing.",
  "Never claim a background task has finished unless you were told so.",
  "For a connected app, find the action with `app_tools`, then run it with `app_call`. Reading runs at once; sending, changing, deleting or paying goes to the user for approval and runs in the background.",
  "Messages starting with [browser task …] or [app action …] are reports from your background work, not from the user: pass on what matters, briefly, and if the user is needed tell them what to do.",
  untrustedRule,
].join("\n");
const keyFile = process.env["REMUSE_COMPOSIO_KEY_FILE"];
const composioClient = keyFile ? composio(readFileSync(keyFile, "utf8").trim()) : undefined;
const composioUser = "owner";
const publicUrl = process.env["REMUSE_PUBLIC_URL"];
const connector =
  composioClient &&
  composioConnector(composioClient, {
    userId: composioUser,
    timers: realTimers,
    ...(publicUrl ? { callbackUrl: (key: string) => `${new URL("/connected", publicUrl)}?key=${key}` } : {}),
  });
const browserState = process.env["REMUSE_BROWSER_STATE"];
const browsers = process.env["REMUSE_BROWSER"] === "chromium" ? pool(browserState ? { stateFile: browserState } : {}) : undefined;
/**
 * With a model, every port is real and chosen here on purpose; a capability
 * that is not configured fails plainly instead of falling back to a script.
 * Without a model the whole thing is the scripted demo (with its seed).
 */
const real = (model: string, authPath: string): Ports => ({
  ...piAgent({ model, authPath, system, ...(composioClient ? { apps: composioApps(composioClient, composioUser) } : {}) }),
  ...(browsers
    ? piBrowserAgent({ model, authPath }, browsers)
    : {
        browse: (browser, io) => void io.act({ kind: "browserStatus", id: browser.id, status: "failed" }),
        browser: () => {},
      }),
  approval: () => {}, // waiting agents get the verdict through AgentIO.decision
  stopTask: () => {}, // no task runner yet: the rules already recorded the stop
  connect: connector
    ? connector.connect
    : async () => {
        throw new Error("No connector is configured (set REMUSE_COMPOSIO_KEY_FILE).");
      },
});
const demo = !(model && authPath);
const ports: Ports = model && authPath ? real(model, authPath) : { ...demoPorts(realTimers), ...(browsers ? browserPorts(browsers) : {}) };

const journalPath = process.env["REMUSE_JOURNAL"];
const journal = journalPath ? { journal: fileJournal(journalPath) } : {};
const session = createHost(ports, { ...(demo ? { seed: seed() } : {}), ...journal });

// the live channel asks the conversation, folded here like any client, who holds a run
const synced = await session.call("session.sync", { since: null });
let state: State = synced.kind === "snapshot" ? synced.state : empty;
session.subscribe((envelope) => (state = apply(state, envelope)));
const live = browsers && {
  pool: browsers,
  controlled: (id: string) => state.entities.some((e) => e.kind === "browser" && e.id === id && e.status === "paused"),
};

const web = process.env["REMUSE_WEB"];
await listen({ session, ...(live ? { live } : {}), ...(web ? { web } : {}), ...(connector ? { returned: connector.returned } : {}), token, port, host });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void (browsers?.shutdown() ?? Promise.resolve()).finally(() => process.exit(0)));
console.log(
  `remuse api on ws://${host}:${port}/rpc (agent: ${model && authPath ? model : "scripted"}, connectors: ${keyFile ? "composio" : "scripted"}, browser: ${browsers ? "chromium" : "scripted"})`,
);
