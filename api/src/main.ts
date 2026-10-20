/**
 * Dev entry: the core host with the demo ports, served on 127.0.0.1.
 *   REMUSE_TOKEN  the access token; or REMUSE_TOKEN_FILE, where one is made on first start and kept
 *                 (refuses to start with neither)
 *   REMUSE_PORT   default 8797
 *   REMUSE_HOST   default 127.0.0.1
 *   REMUSE_PI_MODEL  when set, the agents are Pi with this model (provider/model-id); else a scripted demo
 *   REMUSE_PI_BROWSER_MODEL  the browser agent's model, if not the same
 *   REMUSE_PI_AUTH  a Pi auth file; without one, keys come from the providers' standard
 *                 variables (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, …)
 *   REMUSE_COMPOSIO_KEY_FILE or REMUSE_COMPOSIO_KEY  a Composio developer key (ak_…): connectors go
 *                 through Composio; read once, never logged
 *   REMUSE_JOURNAL  JSONL file the event log lives in (survives restarts); in memory if unset
 *   REMUSE_BROWSERS  the auto-browser pool: name|controller URL|noVNC URL, comma-separated
 *                 (see compose.browsers.yaml); AUTO_BROWSER_TOKEN_FILE holds the controllers' bearer token
 *   REMUSE_PUBLIC_URL  this server's address as the user's browser reaches it (http://host:port);
 *                 lets connectors send the user straight back for an instant "connected"
 *   REMUSE_ALLOWED_ORIGINS  comma-separated origins of other pages allowed to open the sockets (dev web server)
 *   REMUSE_WEB    directory of the built web app to serve (same origin as /rpc and /live)
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { composio, composioApps, composioConnector } from "@remuse/composio";
import { fileJournal } from "./journal.ts";
import { browserPool, controller } from "@remuse/browser";
import { type Ports, createHost, realTimers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import { type State, apply, empty } from "@remuse/protocol";
import { type PiAuth, piAgent, piBrowserAgent, untrustedRule } from "@remuse/pi";
import { listen } from "./server.ts";

/** The access token: given, or made on first start and kept in REMUSE_TOKEN_FILE (owner-only). */
function accessToken(): string | undefined {
  const given = process.env["REMUSE_TOKEN"];
  if (given) return given;
  const file = process.env["REMUSE_TOKEN_FILE"];
  if (!file) return undefined;
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600, flag: "wx" });
  return readFileSync(file, "utf8").trim();
}
const token = accessToken();
if (!token) {
  console.error("Set REMUSE_TOKEN (or REMUSE_TOKEN_FILE, to have one made); refusing to start.");
  process.exit(1);
}
const port = Number(process.env["REMUSE_PORT"] ?? 8797);
const host = process.env["REMUSE_HOST"] ?? "127.0.0.1";

/** the chat agent's model, and the browser agent's (the chat model unless set) */
const model = process.env["REMUSE_PI_MODEL"];
const browserModel = process.env["REMUSE_PI_BROWSER_MODEL"] || model;
const authFile = process.env["REMUSE_PI_AUTH"];
/** a Pi auth file, else the providers' standard variables (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, …) */
const auth: PiAuth = authFile ? { kind: "file", path: authFile } : { kind: "environment" };
const system = [
  "You are Muse, a personal assistant in a chat app. Write like a person texting: short, plain sentences in the user's language, usually one to three. Plain text only: no markdown (no headings, bold, lists or tables), no emoji. Say a longer thing as a few short messages' worth of plain prose, not a document.",
  "When a request needs a website, start a browser task with `browse` and tell the user it is running; it continues in the background and they can watch or take over.",
  "When a request needs one of the user's apps (mail, calendar, sheets, ...), ask with `request_connection` instead of guessing.",
  "Never claim a background task has finished unless you were told so.",
  "For a connected app, find the action with `app_tools`, then run it with `app_call`. Reading runs at once; sending, changing, deleting or paying goes to the user for approval and runs in the background.",
  "Messages starting with [browser task …] or [app action …] are reports from your background work, not from the user: pass on what matters, briefly, and if the user is needed tell them what to do.",
  "Give every tool call a short `status`: a few words in the user's language saying what you are doing; it shows under your name while the tool runs.",
  untrustedRule,
].join("\n");
const keyFile = process.env["REMUSE_COMPOSIO_KEY_FILE"];
const composioKey = keyFile ? readFileSync(keyFile, "utf8").trim() : process.env["REMUSE_COMPOSIO_KEY"];
const composioClient = composioKey ? composio(composioKey) : undefined;
const composioUser = "owner";
const publicUrl = process.env["REMUSE_PUBLIC_URL"];
const connector =
  composioClient &&
  composioConnector(composioClient, {
    userId: composioUser,
    timers: realTimers,
    ...(publicUrl ? { callbackUrl: (key: string) => `${new URL("/connected", publicUrl)}?key=${key}` } : {}),
  });
/** "name|http://controller:8000|http://node:6080, …" → nodes whose noVNC websocket is …/websockify */
/** The controllers' bearer token, made on first start by compose.browsers.yaml's `secrets`. */
const tokenFile = process.env["AUTO_BROWSER_TOKEN_FILE"];
const browserToken = tokenFile ? readFileSync(tokenFile, "utf8").trim() : "";
const nodes = (process.env["REMUSE_BROWSERS"] ?? "")
  .split(",")
  .map((entry) => entry.trim().split("|"))
  .flatMap(([name, api, novnc]) => {
    if (!name || !api || !novnc) return [];
    const vnc = new URL("/websockify", novnc);
    vnc.protocol = vnc.protocol === "https:" ? "wss:" : "ws:";
    return [{ name, controller: controller(api, browserToken), vnc: vnc.toString() }];
  });
const browsers = nodes.length > 0 ? browserPool(nodes) : undefined;
await browsers?.reset();
/**
 * With a model, every port is real and chosen here on purpose; a capability
 * that is not configured fails plainly instead of falling back to a script.
 * Without a model the whole thing is the scripted demo (with its seed).
 */
const real = (model: string, browserModel: string): Ports => ({
  ...piAgent({ model, auth, system, ...(composioClient ? { apps: composioApps(composioClient, composioUser) } : {}) }),
  ...(browsers
    ? piBrowserAgent({ model: browserModel, auth }, browsers)
    : {
        browse: (browser, io) => {
          if (io.act({ kind: "browserStatus", id: browser.id, status: "failed" }).ok)
            io.report(`[browser task "${browser.title}" failed] No browser is configured on this server.`);
        },
        browser: () => {},
        fit: () => {},
      }),
  approval: () => {}, // waiting agents get the verdict through AgentIO.decision
  stopTask: () => {}, // no task runner yet: the rules already recorded the stop
  connect: connector
    ? connector.connect
    : async () => {
        throw new Error("No connector is configured (set REMUSE_COMPOSIO_KEY_FILE).");
      },
});
const demo = !(model && browserModel);
const ports: Ports = model && browserModel ? real(model, browserModel) : demoPorts(realTimers);

const journalPath = process.env["REMUSE_JOURNAL"];
const journal = journalPath ? { journal: fileJournal(journalPath) } : {};
const session = createHost(ports, { ...(demo ? { seed: seed() } : {}), ...journal });

// the live channel asks the conversation, folded here like any client, who holds a run
const synced = await session.call("session.sync", { since: null });
let state: State = synced.kind === "snapshot" ? synced.state : empty;
session.subscribe((update) => (state = update.kind === "event" ? apply(state, update.envelope) : update.state));
const live = browsers && {
  browsers,
  controlled: (id: string) => state.entities.some((e) => e.kind === "browser" && e.id === id && e.status === "paused"),
};

const web = process.env["REMUSE_WEB"];
const origins = (process.env["REMUSE_ALLOWED_ORIGINS"] ?? "").split(",").map((o) => o.trim()).filter(Boolean);
await listen({ session, ...(live ? { live } : {}), ...(web ? { web } : {}), ...(connector ? { returned: connector.returned } : {}), origins, token, port, host });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => process.exit(0));
// the way in, for whoever reads the logs of their own instance: open it once per device
if (publicUrl) console.log(`remuse is ready. Open this link once on each device: ${new URL(`/#token=${token}`, publicUrl).href}`);
console.log(
  `remuse api on ws://${host}:${port}/rpc (agent: ${model ? (browserModel === model ? model : `${model}, browser ${browserModel}`) : "scripted"}, connectors: ${composioClient ? "composio" : "scripted"}, browsers: ${nodes.length ? nodes.map((n) => n.name).join(",") : "none"})`,
);
