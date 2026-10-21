/**
 * Runs the sandbox's control daemon (see daemon.ts).
 *   AMUSE_SANDBOX_PORT  default 7070
 *   AMUSE_SANDBOX_HOST  default 0.0.0.0: the sandbox network is the only way in
 *   AMUSE_SANDBOX_HOME  the user's home folder; default /home/amuse
 *   AMUSE_SANDBOX_WORKSPACE  the folder shared with Amuse; default <home>/workspace
 *   AMUSE_SANDBOX_CONTAINER  1 in the sandbox's own container (the image sets it): a reset may end every process there
 *   AMUSE_SANDBOX_READY  the file sandbox-net puts once its network rules are in (ready.ts): nothing is started before it is there,
 *                 and the daemon ends if it goes; without it (outside the container), no waiting
 * Started as root (as in the container), commands run as the user `amuse`, uid and gid 1000.
 *
 * This daemon is the container's only process, and nothing in the sandbox starts by itself: no cron, no init
 * scripts, nothing read from the home folder at start. Whatever runs there was asked for through the daemon, so
 * while this waits for the rules, nothing in the sandbox can open a connection. Keep it that way.
 */
import { join } from "node:path";
import { PORT } from "./protocol.ts";
import { type Listening, serve } from "./daemon.ts";
import { untilReady, watchReady } from "./ready.ts";
import { watchNetwork } from "./watch.ts";

const container = process.env["AMUSE_SANDBOX_CONTAINER"] === "1";
const ready = process.env["AMUSE_SANDBOX_READY"];
let server: Listening | undefined;
/** End (the container with everything in it) and be restarted by Docker: closed first, if it is open. */
const end = (why: string) => {
  console.error(why);
  void (server?.close() ?? Promise.resolve()).then(() => process.exit(1));
};
// in the container, the network belongs to sandbox-net: if it goes, so does this one's interface, and waiting for a mark for a
// network that is not this one's would be for ever; end, to be restarted into the new one (also while still waiting below)
if (container) watchNetwork(() => end("the sandbox's network is gone: ending, to be restarted into the new one"));
if (ready) {
  let said = false;
  await untilReady(ready, {
    waiting: () => {
      if (!said) console.log("waiting for the network rules (sandbox-net)");
      said = true;
    },
  });
}

const home = process.env["AMUSE_SANDBOX_HOME"] ?? "/home/amuse";
server = await serve({
  home,
  workspace: process.env["AMUSE_SANDBOX_WORKSPACE"] ?? join(home, "workspace"),
  skeleton: "/etc/skel",
  port: Number(process.env["AMUSE_SANDBOX_PORT"] ?? PORT),
  host: process.env["AMUSE_SANDBOX_HOST"] ?? "0.0.0.0",
  ...(process.getuid?.() === 0 ? { user: { uid: 1000, gid: 1000, name: "amuse" } } : {}),
  isolated: container,
});
const listening = server;
// docker stop reaches the daemon through the container's init: end cleanly, commands with it
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void listening.close().then(() => process.exit(0)));
console.log(`amuse sandbox daemon on :${listening.port}`);
// and so is the mark that its rules are in: without it, end, and wait for it again on the restart
if (ready) watchReady(ready, () => end("the network rules are no longer marked as in place: ending"));
