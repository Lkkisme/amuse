/**
 * The server: the core host with Pi agents, served on 127.0.0.1. Who may use it
 * is whoever knows the master password, set on the first visit (access.json
 * beside the journal); the model providers' keys, Composio's and the models
 * chosen are set up in the app (keys.json, models.json).
 *   REMUSE_PORT   default 8797
 *   REMUSE_HOST   default 127.0.0.1
 *   REMUSE_JOURNAL  JSONL file the event log lives in (survives restarts), with the rest of the
 *                 data beside it; without one, everything goes in a temporary folder
 *   REMUSE_PI_MODEL, REMUSE_PI_BROWSER_MODEL, <PROVIDER>_API_KEY, REMUSE_PI_AUTH, REMUSE_COMPOSIO_KEY(_FILE)
 *                 read once, when there is no keys.json yet: taken over into it
 *   REMUSE_BROWSERS  the auto-browser pool: name|controller URL|noVNC URL, comma-separated
 *                 (see compose.browsers.yaml); AUTO_BROWSER_TOKEN_FILE holds the controllers' bearer token
 *   REMUSE_PUBLIC_URL  this server's address as the user's browser reaches it (http://host:port);
 *                 lets connectors send the user straight back for an instant "connected"
 *   REMUSE_WEB    directory of the built web app to serve (same origin as /rpc and /live)
 */
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { NoComposioKey, composio, composioApps, composioGuide, composioConnector, composioDirectory, keyedComposio } from "@remuse/composio";
import { fileChats } from "./journal.ts";
import { workspace } from "./workspace.ts";
import { browserPool, controller } from "@remuse/browser";
import { type Ports, Rejected, createHost, memoryRules, realTimers } from "@remuse/core";
import type { Entity } from "@remuse/protocol";
import { type PiAuth, adoptEnvironment, fileCredentials, piAgent, piBrowserAgent, piKeys, piScheduleRunner, piTaskRunner, untrustedRule } from "@remuse/pi";
import { fileAccess } from "./access.ts";
import { listen } from "./server.ts";
import { fileRules } from "./rules.ts";

const port = Number(process.env["REMUSE_PORT"] ?? 8797);
const host = process.env["REMUSE_HOST"] ?? "127.0.0.1";

/** where everything is kept: beside the journal (or, with none, somewhere that goes with this run) */
const journalFile = process.env["REMUSE_JOURNAL"];
const dataDir = journalFile ? dirname(journalFile) : mkdtempSync(join(tmpdir(), "remuse-data-"));
const access = fileAccess(join(dataDir, "access.json"));

/** The user's keys and models, set up in the app; what the environment held before is taken over once. */
const keysPath = join(dataDir, "keys.json");
const choicePath = join(dataDir, "models.json");
const keyFile = process.env["REMUSE_COMPOSIO_KEY_FILE"];
const adopted = await adoptEnvironment({
  keysPath,
  choicePath,
  apps: {
    composio: keyFile ? readFileSync(keyFile, "utf8").trim() : process.env["REMUSE_COMPOSIO_KEY"],
  },
  env: process.env,
  ...(process.env["REMUSE_PI_AUTH"] ? { authFile: process.env["REMUSE_PI_AUTH"] } : {}),
});
if (adopted.length > 0) console.log(`Keys taken over from the environment: ${adopted.join(", ")}. Set them in the app from now on.`);
const credentials = fileCredentials(keysPath);
const keys = piKeys({
  keys: credentials,
  choicePath,
  apps: [
    {
      id: "composio",
      name: "Composio",
      message: "Your Composio API key (starts with ak_)",
      // per Composio's docs
      where: "Sign in at composio.dev, open Settings › Project Settings, and copy the key under API Keys.",
      link: { url: "https://composio.dev/", label: "Open composio.dev" },
      // a key that lists the user's accounts works
      test: async (key) => void (await composio(key).accounts(composioUser)),
    },
  ],
});
const auth: PiAuth = { kind: "keys", keys: credentials };
const model = () => keys.model("chat");
const browserModel = () => keys.model("browser");
const system = [
  "You are Muse, a personal assistant in a chat app. Write like a person texting: short, plain sentences, usually one to three. Plain text only: no markdown (no headings, bold, lists or tables), no emoji. Say a longer thing as a few short messages' worth of plain prose, not a document.",
  "Reply in the language and script of the user's latest message, unless they ask for another; a foreign word in their message does not change it. Pages, mails and tool results in other languages never change it: read them as they are, say it in the user's language. Something you write for them to use elsewhere (a post, an email) is in the language they ask for it in.",
  'Talk like a capable secretary, not like software. The user hears what you did and found, not how it works inside: unless they ask, never mention ids (b-…, s-…, q-…), tool or function names, agents, runs, sessions, reports, notes, prompts or internal statuses. Say "I\'m opening the site", "I\'ll check your mail every hour", "it\'s asking which date you want", in plain words. What you hear from your background work stays between you and it; pass on only what the user needs, in your own words. If the user does ask how something works or what you did, answer plainly and truthfully.',
  "Do quick things yourself: a fact to look up, a page to read, something to fetch from a connected app, a file to sort. Hand work off only when: it is long and self-contained (`start_task`, so the chat goes on), several independent pieces can go at once (a task each), a website must be operated (`browse`: only a browser task drives a browser), or it should run later or regularly (`schedule`). Do not hand off what you can answer at once.",
  "Each turn you get the conversation so far: the newest part in full, older parts in brief. If you need something older or cut short, search it with `recall`.",
  "To look something up, use `web_search` and `web_read`: quick, no browser. Start a browser task only when something on a site has to be done (log in, fill a form, click through).",
  'When a request needs a website, start a browser task with `browse` and tell the user it is running; it continues in the background and they can watch or take over. A browser stays open between jobs with its own agent, which remembers what happened in it: for more on the same site (or in a browser the user opened, "Your browser"), give the job to that open, idle browser (`browser`) rather than opening another. The browser agent sees nothing but what you give it: put the user\'s whole ask in `instructions`, including every limit they set, and give it in `files` only the workspace files it must upload (it is asked each time). What it downloads lands in downloads/; send what the user wants with `send_file`.',
  "When a request needs one of the user's apps (mail, calendar, sheets, ...), ask with `request_connection` instead of guessing.",
  "Apps connect through Composio, with the user's own Composio API key, which they add in Settings › Connectors (they find it on composio.dev under Settings › Project Settings › API Keys). If apps are not set up yet, your app tools and `request_connection` say so: then walk the user through adding the key, a step at a time, in plain words. The key goes only in Settings, never in the chat.",
  "You have a workspace of files you share with the user. What they send lands in user/ (pictures and videos in user/media_library/) and shows in the conversation as [attached: name (type, size) at path]; what the browser downloads lands in downloads/; the rest is yours to organize. You see the images of the message you are answering; look at any file with `read_file`, and keep things in order with `list_files`, `write_file`, `move_file` and `delete_file`. To give the user a file, send it with `send_file`.",
  "Never claim a background task has finished unless you were told so. Never say you will do something and stop: what you are going to do, you do now with your tools, in this turn; your reply ends the turn.",
  "Before you act for the user toward others or do what is hard to undo (send a message or an email, post publicly, delete data), make sure they want it. The specific thing they asked for in their message is their confirmation: do not ask again. Their OK covers only that action and that content; if either changes, show them again. Buying is the exception: even when they say buy, go through the checkout for them to review before paying.",
  "Some steps show the user an approval card on their own (how they set their permissions decides which). The card is theirs, not yours: when a tool or your background work says it waits for their OK, tell them in a sentence what it wants and why, and never say it is done until you hear it was. If they decline or never answer, that step does not happen: do not try another way around it.",
  "For a connected app, find the action with `app_tools`, then run it with `app_call`. Reading runs at once; sending, changing, deleting or paying goes to the user for approval and runs in the background.",
  "For anything to do later or regularly (a briefing every morning, checking the mail every hour, a reminder tomorrow), use `schedule`. Each run is a background agent that tells you only what is worth telling; put everything it needs in `instructions`, including what is worth reporting.",
  "Messages starting with [browser task …], [task …], [app action …] or [scheduled task …] are reports from your background work, not from the user: pass on what matters, briefly, and if the user is needed tell them what to do.",
  "Your runs in flight (browser tasks b-…, tasks t-…, schedules' runs s-…) keep working while you chat. When the user adds to or changes what one should do, tell it with `message_run`; when they want it stopped, `stop_run`. When a run asks a question (q-…), put it to the user in your own words; once they answer, pass it on with `answer_question`. Never answer for the user. Ids are for your tools only.",
  'Give every tool call a short `status`: a few words in the user\'s language saying what you are doing, as the user would put it ("查看最新邮件", not a tool name); it shows under your name while the tool runs.',
  untrustedRule,
].join("\n");
/** apps go through Composio, with the key set up now (none: each use says it is needed) */
const composioClient = keyedComposio(() => keys.appKey("composio"));
const composioUser = "owner";
/** what the agent may do with apps (core/policy.ts): kept beside the journal, or in memory without one */
const rules = journalFile ? fileRules(join(dataDir, "rules.json")) : memoryRules();
// Muse's workspace, and the index of sent files beside it
const files = workspace(join(dataDir, "workspace"), join(dataDir, "sent.json"));
const publicUrl = process.env["REMUSE_PUBLIC_URL"];
const connector = composioConnector(composioClient, {
  userId: composioUser,
  timers: realTimers,
  ...(publicUrl
    ? {
        callbackUrl: (key: string) => `${new URL("/connected", publicUrl)}?key=${key}`,
      }
    : {}),
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
    return [
      {
        name,
        controller: controller(api, browserToken),
        vnc: vnc.toString(),
        ...(handoff ? { handoff: { local: handoff, remote: "/data/uploads" } } : {}),
      },
    ];
  });
const browsers = nodes.length > 0 ? browserPool(nodes) : undefined;
await browsers?.reset();
/**
 * Every port is real and chosen here on purpose; a capability that is not
 * set up (no model, no Composio key, no browsers) fails plainly, saying what
 * is needed, instead of falling back to a script.
 */
const apps = composioApps(composioClient, composioUser, rules);
const directory = composioDirectory(composioClient, {
  userId: composioUser,
  rules,
  ...(publicUrl ? { callbackUrl: new URL("/connected", publicUrl).href } : {}),
});
/** without a key, there is nothing connected (rather than an error) */
const none = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NoComposioKey) return [];
    throw error;
  }
};
const ports: Ports = {
  ...piAgent({ model, auth, system, rules, files, apps, search: apps.search, appsSetup: () => (keys.appKey("composio") ? null : composioGuide) }),
  ...piScheduleRunner({
    model,
    auth,
    system,
    rules,
    files,
    apps,
    search: apps.search,
  }),
  ...piTaskRunner({
    model,
    auth,
    system,
    rules,
    files,
    apps,
    search: apps.search,
  }),
  files,
  keys,
  ...(browsers
    ? piBrowserAgent({ model: browserModel, auth }, browsers, rules, files)
    : {
        browse: (browser, io) => {
          if (
            io.act({
              kind: "browserEnded",
              id: browser.id,
              status: "failed",
              result: "No browser is configured on this server.",
            }).ok
          )
            io.report(`[browser task "${browser.title}" failed] No browser is configured on this server.`);
          io.act({ kind: "released", id: browser.id });
        },
        job: () => {},
        browser: () => {},
        fit: () => {},
      }),
  rules,
  approval: () => {}, // waiting agents get the verdict through AgentIO.decision
  // a card from before the key was removed: the user hears where to add one
  connect: async (connection, io) => {
    if (!keys.appKey("composio")) throw new Rejected({ kind: "unsound", reason: "Apps are not set up yet: add a Composio key in Settings › Connectors." });
    return connector.connect(connection, io);
  },
  apps: {
    ...directory,
    accounts: () => none(directory.accounts),
    permissions: (app) => none(() => directory.permissions(app)),
  },
};

const journalPath = process.env["REMUSE_JOURNAL"];
// side chats beside the main chat's log
const store = journalPath ? { store: fileChats(dirname(journalPath), journalPath) } : {};
const session = createHost(ports, store);

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
await listen({
  session,
  files,
  ...(live ? { live } : {}),
  ...(web ? { web } : {}),
  returned: connector.returned,
  access,
  port,
  host,
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => process.exit(0));
// the way in: the first visit sets the master password
if (!access.ready()) console.log(`remuse is ready. Open ${publicUrl ?? `http://${host}:${port}`} and set the master password.`);
console.log(
  `remuse api on ws://${host}:${port}/rpc (model: ${model() ?? "none chosen"}, browser model: ${browserModel() ?? "none chosen"}, apps: ${keys.appKey("composio") ? "composio" : "no key"}, browsers: ${nodes.length ? nodes.map((n) => n.name).join(",") : "none"})`,
);
