/**
 * Dev entry: the core host with the demo ports, served on 127.0.0.1.
 *   REMUSE_TOKEN  required access token (refuses to start without one)
 *   REMUSE_PORT   default 8797
 *   REMUSE_HOST   default 127.0.0.1
 */
import { createHost, demoPorts, realTimers, seed } from "@remuse/core";
import { listen } from "./server.ts";

const token = process.env["REMUSE_TOKEN"];
if (!token) {
  console.error("REMUSE_TOKEN is not set; refusing to start.");
  process.exit(1);
}
const port = Number(process.env["REMUSE_PORT"] ?? 8797);
const host = process.env["REMUSE_HOST"] ?? "127.0.0.1";

await listen({ session: createHost(demoPorts(realTimers), { seed: seed() }), token, port, host });
console.log(`remuse api on ws://${host}:${port}/rpc`);
