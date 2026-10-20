/**
 * Dev entry: the core host with the demo ports, served on 127.0.0.1.
 *   REMUSE_TOKEN  required access token (refuses to start without one)
 *   REMUSE_PORT   default 8797
 *   REMUSE_HOST   default 127.0.0.1
 *   REMUSE_PI_MODEL, REMUSE_PI_AUTH  when both are set, the agent is Pi (provider/model-id,
 *                 Pi auth file)
 *   REMUSE_COMPOSIO_KEY_FILE  file holding a Composio developer key (ak_…): connectors go
 *                 through Composio; read once, never logged
 *   Browser and approvals stay scripted for now.
 */
import { readFileSync } from "node:fs";
import { composio, composioConnector } from "@remuse/composio";
import { createHost, demoPorts, realTimers, seed } from "@remuse/core";
import { piAgent } from "@remuse/pi";
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
].join("\n");
const keyFile = process.env["REMUSE_COMPOSIO_KEY_FILE"];
const ports = {
  ...demoPorts(realTimers),
  ...(model && authPath ? piAgent({ model, authPath, system }) : {}),
  ...(keyFile ? composioConnector(composio(readFileSync(keyFile, "utf8").trim()), { userId: "owner", timers: realTimers }) : {}),
};

await listen({ session: createHost(ports, { seed: seed() }), token, port, host });
console.log(`remuse api on ws://${host}:${port}/rpc (agent: ${model && authPath ? model : "scripted"}, connectors: ${keyFile ? "composio" : "scripted"})`);
