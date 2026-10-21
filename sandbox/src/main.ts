/**
 * Runs the sandbox's control daemon (see daemon.ts).
 *   AMUSE_SANDBOX_PORT  default 7070
 *   AMUSE_SANDBOX_HOST  default 0.0.0.0: the sandbox network is the only way in
 *   AMUSE_SANDBOX_WORKSPACE  the folder shared with Amuse; default <home>/workspace
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { PORT } from "./protocol.ts";
import { serve } from "./daemon.ts";

const home = homedir();
const server = await serve({
  home,
  workspace: process.env["AMUSE_SANDBOX_WORKSPACE"] ?? join(home, "workspace"),
  skeleton: "/etc/skel",
  port: Number(process.env["AMUSE_SANDBOX_PORT"] ?? PORT),
  host: process.env["AMUSE_SANDBOX_HOST"] ?? "0.0.0.0",
});
// as the machine's first process, it must answer the stop that ends the container itself
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void server.close().then(() => process.exit(0)));
console.log(`amuse sandbox daemon on :${server.port}`);
