/**
 * The sandbox's network owner (see egress.ts): the container that holds the sandbox's network namespace. It is
 * the only one there with NET_ADMIN. Its network is up before this runs, and may be used by the sandbox in the
 * meantime (Docker's own restarts do not wait for it), so the order matters:
 *   1. take away the ready mark (ready.ts), so nothing in the sandbox runs on a mark from before;
 *   2. put in a blanket refusal of everything but loopback, first of all;
 *   3. put in the real rules, all at once (the whole table is replaced), and check them against the kernel's list;
 *   4. flush the connection table, so nothing opened before is remembered as open;
 *   5. put the ready mark.
 * If a step fails it does not exit: it says why, leaves the blanket refusal (or no mark) as it is, and stays
 * running, unhealthy, trying again; the sandbox does not start, or ends, without the mark.
 *   node net.ts          install the rules, then stay
 *   node net.ts check    exit 0 if the rules are in place and the mark is there (the health check)
 *   AMUSE_SANDBOX_SUBNET  the network's address range, refused too (the Amuse server is on it)
 *   AMUSE_SANDBOX_READY   where the ready mark is put
 *   AMUSE_SANDBOX_IPV6    1: IPv6 egress is allowed (under the same rules); otherwise none leaves
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { type Network, blanketRules, egressRules, gatewayOf, hasV6, missingRules, v6Of } from "./egress.ts";
import { isReady, markReady, unmark } from "./ready.ts";

const run = promisify(execFile);
const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const mark = process.env["AMUSE_SANDBOX_READY"];
const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What this namespace is, as the kernel says it. */
function network(): Network {
  return {
    subnet: process.env["AMUSE_SANDBOX_SUBNET"] || null,
    gateway: gatewayOf(read("/proc/net/route")),
    v6: process.env["AMUSE_SANDBOX_IPV6"] === "1" ? v6Of(read("/proc/net/if_inet6"), read("/proc/net/ipv6_route")) : null,
  };
}

/** Whether the namespace has any IPv6 address besides loopback's: where it has none, a kernel without ip6tables is no harm. */
const hasAnyV6 = () => hasV6(read("/proc/net/if_inet6")).any;

/** Put a whole table in, atomically replacing the one there. */
async function apply(tool: string, rules: string): Promise<void> {
  const restoring = run(`${tool}-restore`);
  restoring.child.stdin?.end(rules);
  await restoring;
}

async function applyBoth(set: { v4: string; v6: string }): Promise<void> {
  await apply("iptables", set.v4);
  // without any IPv6 address here nothing can leave that way, and a kernel without ip6tables cannot be told otherwise
  await apply("ip6tables", set.v6).catch((error: unknown) => {
    if (hasAnyV6()) throw error;
  });
}

/** What of `set` is not in place, for IPv4 and (where there is IPv6 at all) IPv6. */
async function missing(set: { v4: string; v6: string }): Promise<string[]> {
  const listing = async (tool: string) => (await run(tool, ["-S"])).stdout;
  const lacking = missingRules(set.v4, await listing("iptables"));
  if (!hasAnyV6()) return lacking;
  return [...lacking, ...missingRules(set.v6, await listing("ip6tables").catch(() => ""))];
}

/** Everything in place, or why not (empty: it is). */
async function problems(set: { v4: string; v6: string }): Promise<string[]> {
  const lacking = await missing(set).catch((error: unknown) => [`the rules cannot be read: ${said(error)}`]);
  if (lacking.length === 0 && mark && !isReady(mark)) return ["the ready mark is not there"];
  return lacking;
}

async function install(): Promise<void> {
  if (mark) unmark(mark);
  await applyBoth(blanketRules());
  const where = network();
  const set = egressRules(where);
  await applyBoth(set);
  const lacking = await missing(set);
  if (lacking.length > 0) throw new Error(`the rules did not go in:\n${lacking.join("\n")}`);
  // nothing opened before the rules is remembered as open (the rules refuse the private ones whatever their state; this is for the rest)
  await run("conntrack", ["-F"]).catch((error: unknown) => console.error(`the connection table could not be flushed: ${said(error)}`));
  if (mark) markReady(mark);
  console.log(
    `sandbox egress: public internet only (gateway ${where.gateway ?? "unknown"}, subnet ${where.subnet ?? "unknown"}, ipv6 ${where.v6 ? "allowed" : "refused"})${mark ? "; ready" : ""}`,
  );
}

if (process.argv[2] === "check") {
  const where = network();
  const lacking = await problems(egressRules(where));
  if (lacking.length > 0) {
    console.error(`egress not in place:\n${lacking.join("\n")}`);
    process.exit(1);
  }
} else {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (mark) unmark(mark);
      process.exit(0);
    });
  }
  // stay running whatever happens: an exit would restart the container into an open network for a moment, again and again
  for (;;) {
    try {
      await install();
      break;
    } catch (error) {
      if (mark) unmark(mark);
      console.error(
        `sandbox egress is NOT in place (the sandbox does not run; where the blanket refusal went in, nothing but loopback is let out): ${said(error)}`,
      );
      await new Promise((done) => setTimeout(done, 15_000));
    }
  }
  setInterval(() => {}, 1 << 30);
}
