/**
 * Runs the sandbox's control daemon (see daemon.ts).
 *   AMUSE_SANDBOX_PORT  default 7070
 *   AMUSE_SANDBOX_HOST  default 0.0.0.0: the sandbox network is the only way in
 *   AMUSE_SANDBOX_HOME  the user's home folder; default /home/amuse
 *   AMUSE_SANDBOX_WORKSPACE  the folder shared with Amuse; default <home>/workspace
 *   AMUSE_SANDBOX_CONTAINER  1 in the sandbox's own container (the image sets it): a reset may end every process there
 * Started as root (as in the container), commands run as the user `amuse`, uid and gid 1000.
 */
import { join } from "node:path";
import { PORT } from "./protocol.ts";
import { serve } from "./daemon.ts";
import { watchNetwork } from "./watch.ts";

const home = process.env["AMUSE_SANDBOX_HOME"] ?? "/home/amuse";
const server = await serve({
  home,
  workspace: process.env["AMUSE_SANDBOX_WORKSPACE"] ?? join(home, "workspace"),
  skeleton: "/etc/skel",
  port: Number(process.env["AMUSE_SANDBOX_PORT"] ?? PORT),
  host: process.env["AMUSE_SANDBOX_HOST"] ?? "0.0.0.0",
  ...(process.getuid?.() === 0 ? { user: { uid: 1000, gid: 1000, name: "amuse" } } : {}),
  isolated: process.env["AMUSE_SANDBOX_CONTAINER"] === "1",
});
// docker stop reaches the daemon through the container's init: end cleanly, commands with it
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void server.close().then(() => process.exit(0)));
console.log(`amuse sandbox daemon on :${server.port}`);
// in the container, the network belongs to sandbox-net: if it goes, so does this one's interface; end, to be restarted into the new one
if (process.env["AMUSE_SANDBOX_CONTAINER"] === "1") {
  watchNetwork(() => {
    console.error("the sandbox's network is gone: ending, to be restarted into the new one");
    void server.close().then(() => process.exit(1));
  });
}
