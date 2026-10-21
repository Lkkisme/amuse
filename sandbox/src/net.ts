/**
 * The sandbox's network owner (see egress.ts): the container that holds the sandbox's network namespace. It is
 * the only one there with NET_ADMIN; it puts the egress rules in the namespace, checks them, and idles, so the
 * sandbox, which shares the namespace without that capability, cannot change them. Healthy means the rules are in.
 *   node net.ts          install the rules, then stay
 *   node net.ts check    exit 0 if the rules are in place (the health check)
 *   AMUSE_SANDBOX_SUBNET  the network's address range, refused too (the Amuse server is on it)
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { type Network, egressRules, gatewayOf, hasV6, missingRules } from "./egress.ts";

const run = promisify(execFile);

/** What this namespace is, as the kernel says it. */
function network(): Network {
  const inet6 = (() => {
    try {
      return hasV6(readFileSync("/proc/net/if_inet6", "utf8"));
    } catch {
      return { global: false, any: false };
    }
  })();
  return { subnet: process.env["AMUSE_SANDBOX_SUBNET"] || null, gateway: gatewayOf(readFileSync("/proc/net/route", "utf8")), v6: inet6.global };
}

/** Whether `set` is in place, for IPv4 and for IPv6 (which may be left out where the namespace has no IPv6 address at all). */
async function verify(set: { v4: string; v6: string }, v6Needed: boolean): Promise<string[]> {
  const listing = async (tool: string) => (await run(tool, ["-S"])).stdout;
  const lacking = missingRules(set.v4, await listing("iptables"));
  if (!v6Needed) return lacking;
  return [...lacking, ...missingRules(set.v6, await listing("ip6tables").catch(() => ""))];
}

const apply = async (tool: string, rules: string) => {
  const restoring = run(`${tool}-restore`, ["--noflush"]);
  restoring.child.stdin?.end(rules);
  await restoring;
};

const where = network();
const set = egressRules(where);
const v6Needed = (() => {
  try {
    return hasV6(readFileSync("/proc/net/if_inet6", "utf8")).any;
  } catch {
    return false;
  }
})();

if (process.argv[2] === "check") {
  const lacking = await verify(set, v6Needed).catch((error: unknown) => [
    `the rules cannot be read: ${error instanceof Error ? error.message : String(error)}`,
  ]);
  if (lacking.length > 0) {
    console.error(`egress rules missing:\n${lacking.join("\n")}`);
    process.exit(1);
  }
} else {
  // already in (the container restarted into the same namespace)? then leave them
  if ((await verify(set, v6Needed).catch(() => ["unknown"])).length > 0) {
    await apply("iptables", set.v4);
    // without any IPv6 address here nothing can leave that way, and a kernel without ip6tables cannot be told otherwise
    await apply("ip6tables", set.v6).catch((error: unknown) => {
      if (v6Needed) throw error;
    });
  }
  const lacking = await verify(set, v6Needed);
  if (lacking.length > 0) {
    console.error(`egress rules did not go in:\n${lacking.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `sandbox egress: public internet only (gateway ${where.gateway ?? "unknown"}, subnet ${where.subnet ?? "unknown"}, ipv6 ${where.v6 ? "on" : "off"})`,
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => process.exit(0));
  setInterval(() => {}, 1 << 30);
}
