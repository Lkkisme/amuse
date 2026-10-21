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
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { composio, composioApps, composioConnector, composioDirectory } from "@remuse/composio";
import { fileChats } from "./journal.ts";
import { workspace } from "./workspace.ts";
import { browserPool, controller } from "@remuse/browser";
import { type Ports, createHost, memoryRules, realTimers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import type { Entity } from "@remuse/protocol";
import { type PiAuth, piAgent, piBrowserAgent, piScheduleRunner, piTaskRunner, untrustedRule } from "@remuse/pi";
import { listen } from "./server.ts";
import { fileRules } from "./rules.ts";

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
  "You are Muse, a personal assistant in a chat app. Write like a person texting: short, plain sentences, usually one to three. Plain text only: no markdown (no headings, bold, lists or tables), no emoji. Say a longer thing as a few short messages' worth of plain prose, not a document.",
  "Reply in the language and script of the user's latest message, unless they ask for another; a foreign word in their message does not change it. Pages, mails and tool results in other languages never change it: read them as they are, say it in the user's language. Something you write for them to use elsewhere (a post, an email) is in the language they ask for it in.",
  "Talk like a capable secretary, not like software. The user hears what you did and found, not how it works inside: unless they ask, never mention ids (b-…, s-…, q-…), tool or function names, agents, runs, sessions, reports, notes, prompts or internal statuses. Say \"I'm opening the site\", \"I'll check your mail every hour\", \"it's asking which date you want\", in plain words. What you hear from your background work stays between you and it; pass on only what the user needs, in your own words. If the user does ask how something works or what you did, answer plainly and truthfully.",
  "Do quick things yourself: a fact to look up, a page to read, something to fetch from a connected app, a file to sort. Hand work off only when: it is long and self-contained (`start_task`, so the chat goes on), several independent pieces can go at once (a task each), a website must be operated (`browse`: only a browser task drives a browser), or it should run later or regularly (`schedule`). Do not hand off what you can answer at once.",
  "Each turn you get the conversation so far: the newest part in full, older parts in brief. If you need something older or cut short, search it with `recall`.",
  "To look something up, use `web_search` and `web_read`: quick, no browser. Start a browser task only when something on a site has to be done (log in, fill a form, click through).",
  "When a request needs a website, start a browser task with `browse` and tell the user it is running; it continues in the background and they can watch or take over. A browser stays open between jobs with its own agent, which remembers what happened in it: for more on the same site (or in a browser the user opened, \"Your browser\"), give the job to that open, idle browser (`browser`) rather than opening another. The browser agent sees nothing but what you give it: put the user's whole ask in `instructions`, including every limit they set, and give it in `files` only the workspace files it must upload (it is asked each time). What it downloads lands in downloads/; send what the user wants with `send_file`.",
  "When a request needs one of the user's apps (mail, calendar, sheets, ...), ask with `request_connection` instead of guessing.",
  "You have a workspace of files you share with the user. What they send lands in user/ (pictures and videos in user/media_library/) and shows in the conversation as [attached: name (type, size) at path]; what the browser downloads lands in downloads/; the rest is yours to organize. You see the images of the message you are answering; look at any file with `read_file`, and keep things in order with `list_files`, `write_file`, `move_file` and `delete_file`. To give the user a file, send it with `send_file`.",
  "Never claim a background task has finished unless you were told so. Never say you will do something and stop: what you are going to do, you do now with your tools, in this turn; your reply ends the turn.",
  "Before you act for the user toward others or do what is hard to undo (send a message or an email, post publicly, delete data), make sure they want it. The specific thing they asked for in their message is their confirmation: do not ask again. Their OK covers only that action and that content; if either changes, show them again. Buying is the exception: even when they say buy, go through the checkout for them to review before paying.",
  "Some steps show the user an approval card on their own (how they set their permissions decides which). The card is theirs, not yours: when a tool or your background work says it waits for their OK, tell them in a sentence what it wants and why, and never say it is done until you hear it was. If they decline or never answer, that step does not happen: do not try another way around it.",
  "For a connected app, find the action with `app_tools`, then run it with `app_call`. Reading runs at once; sending, changing, deleting or paying goes to the user for approval and runs in the background.",
  "For anything to do later or regularly (a briefing every morning, checking the mail every hour, a reminder tomorrow), use `schedule`. Each run is a background agent that tells you only what is worth telling; put everything it needs in `instructions`, including what is worth reporting.",
  "Messages starting with [browser task …], [task …], [app action …] or [scheduled task …] are reports from your background work, not from the user: pass on what matters, briefly, and if the user is needed tell them what to do.",
  "Your runs in flight (browser tasks b-…, tasks t-…, schedules' runs s-…) keep working while you chat. When the user adds to or changes what one should do, tell it with `message_run`; when they want it stopped, `stop_run`. When a run asks a question (q-…), put it to the user in your own words; once they answer, pass it on with `answer_question`. Never answer for the user. Ids are for your tools only.",
  "Give every tool call a short `status`: a few words in the user's language saying what you are doing, as the user would put it (\"查看最新邮件\", not a tool name); it shows under your name while the tool runs.",
  untrustedRule,
].join("\n");
const keyFile = process.env["REMUSE_COMPOSIO_KEY_FILE"];
const composioKey = keyFile ? readFileSync(keyFile, "utf8").trim() : process.env["REMUSE_COMPOSIO_KEY"];
const composioClient = composioKey ? composio(composioKey) : undefined;
const composioUser = "owner";
const noConnector = "No connector is configured (set REMUSE_COMPOSIO_KEY).";
/** what the agent may do with apps (core/policy.ts): kept beside the journal, or in memory without one */
const journalFile = process.env["REMUSE_JOURNAL"];
const rules = journalFile ? fileRules(join(dirname(journalFile), "rules.json")) : memoryRules();
// Muse's workspace beside the journal (or, with none, somewhere that goes with this run); the index of sent files beside it
const dataDir = journalFile ? dirname(journalFile) : mkdtempSync(join(tmpdir(), "remuse-data-"));
const files = workspace(join(dataDir, "workspace"), join(dataDir, "sent.json"));
const publicUrl = process.env["REMUSE_PUBLIC_URL"];
const connector =
  composioClient &&
  composioConnector(composioClient, {
    userId: composioUser,
    timers: realTimers,
    ...(publicUrl ? { callbackUrl: (key: string) => `${new URL("/connected", publicUrl)}?key=${key}` } : {}),
  });
/**
 * "name|http://controller:8000|http://node:6080|/handoff/name, …" → nodes whose noVNC websocket is
 * …/websockify; the last part, if there, is the folder shared with that controller for uploads
 * (it sees it as its upload root, /data/uploads).
 */
/** The controllers' bearer token, made on first start by compose.browsers.yaml's `secrets`. */
const tokenFile = process.env["AUTO_BROWSER_TOKEN_FILE"];
const browserToken = tokenFile ? readFileSync(tokenFile, "utf8").trim() : "";
const nodes = (process.env["REMUSE_BROWSERS"] ?? "")
  .split(",")
  .map((entry) => entry.trim().split("|"))
  .flatMap(([name, api, novnc, handoff]) => {
    if (!name || !api || !novnc) return [];
    const vnc = new URL("/websockify", novnc);
    vnc.protocol = vnc.protocol === "https:" ? "wss:" : "ws:";
    return [{ name, controller: controller(api, browserToken), vnc: vnc.toString(), ...(handoff ? { handoff: { local: handoff, remote: "/data/uploads" } } : {}) }];
  });
const browsers = nodes.length > 0 ? browserPool(nodes) : undefined;
await browsers?.reset();
/**
 * With a model, every port is real and chosen here on purpose; a capability
 * that is not configured fails plainly instead of falling back to a script.
 * Without a model the whole thing is the scripted demo (with its seed).
 */
const apps = composioClient ? composioApps(composioClient, composioUser, rules) : undefined;
const real = (model: string, browserModel: string): Ports => ({
  ...piAgent({ model, auth, system, rules, files, ...(apps ? { apps, search: apps.search } : {}) }),
  ...piScheduleRunner({ model, auth, system, rules, files, ...(apps ? { apps, search: apps.search } : {}) }),
  ...piTaskRunner({ model, auth, system, rules, files, ...(apps ? { apps, search: apps.search } : {}) }),
  files,
  ...(browsers
    ? piBrowserAgent({ model: browserModel, auth }, browsers, rules, files)
    : {
        browse: (browser, io) => {
          if (io.act({ kind: "browserEnded", id: browser.id, status: "failed", result: "No browser is configured on this server." }).ok)
            io.report(`[browser task "${browser.title}" failed] No browser is configured on this server.`);
          io.act({ kind: "released", id: browser.id });
        },
        job: () => {},
        browser: () => {},
        fit: () => {},
      }),
  rules,
  approval: () => {}, // waiting agents get the verdict through AgentIO.decision
  connect: connector
    ? connector.connect
    : async () => {
        throw new Error(noConnector);
      },
  apps: composioClient
    ? composioDirectory(composioClient, { userId: composioUser, rules, ...(publicUrl ? { callbackUrl: new URL("/connected", publicUrl).href } : {}) })
    : {
        search: async () => {
          throw new Error(noConnector);
        },
        accounts: async () => [],
        connect: async () => {
          throw new Error(noConnector);
        },
        disconnect: async () => {
          throw new Error(noConnector);
        },
        permissions: async () => [],
        permit: async () => {
          throw new Error(noConnector);
        },
      },
});
const demo = !(model && browserModel);
const ports: Ports = model && browserModel ? real(model, browserModel) : { ...demoPorts(realTimers), files };

const journalPath = process.env["REMUSE_JOURNAL"];
// side chats beside the main chat's log
const store = journalPath ? { store: fileChats(dirname(journalPath), journalPath) } : {};
const session = createHost(ports, { ...(demo ? { seed: seed() } : {}), ...store });

// the live channel asks which runs the user holds, in any chat: followed here from the events like any client
const held = new Set<string>();
const follow = (entity: Entity) => {
  if (entity.kind !== "browser") return;
  if (entity.status === "paused") held.add(entity.id);
  else held.delete(entity.id);
};
session.subscribe((update) => {
  if (update.kind === "event" && update.envelope.event.kind === "upserted") follow(update.envelope.event.entity);
});
for (const { id } of (await session.call("chats.list", {})).chats) {
  const synced = await session.call("session.sync", { chat: id, since: null });
  if (synced.kind === "snapshot") synced.state.entities.forEach(follow);
}
const live = browsers && { browsers, controlled: (id: string) => held.has(id) };

const web = process.env["REMUSE_WEB"];
const origins = (process.env["REMUSE_ALLOWED_ORIGINS"] ?? "").split(",").map((o) => o.trim()).filter(Boolean);
await listen({ session, files, ...(live ? { live } : {}), ...(web ? { web } : {}), ...(connector ? { returned: connector.returned } : {}), origins, token, port, host });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => process.exit(0));
// the way in, for whoever reads the logs of their own instance: open it once per device
if (publicUrl) console.log(`remuse is ready. Open this link once on each device: ${new URL(`/#token=${token}`, publicUrl).href}`);
console.log(
  `remuse api on ws://${host}:${port}/rpc (agent: ${model ? (browserModel === model ? model : `${model}, browser ${browserModel}`) : "scripted"}, connectors: ${composioClient ? "composio" : "scripted"}, browsers: ${nodes.length ? nodes.map((n) => n.name).join(",") : "none"})`,
);
