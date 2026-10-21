/**
 * What the sandbox may reach: the public internet, and nothing else. The rules are the sandbox's own network
 * namespace's OUTPUT chain, installed by the container that owns that namespace (net.ts) and out of reach of
 * the sandbox, which has no NET_ADMIN even as root. New connections to anything private are refused at once:
 * the host (its gateway address, and every address of its own on a private range), the LAN, Tailscale and other
 * VPN peers (100.64.0.0/10), link-local, loopback off the loopback interface, multicast and reserved ranges,
 * and this network itself (the Amuse server is the only thing on it, and reaches the sandbox, not the other
 * way round). Replies to what comes in are established connections and pass, so the server can reach any port
 * the sandbox listens on. DNS goes to Docker's resolver on loopback.
 */
import { isIPv4 } from "node:net";

/** The chain the rules are in, and what is true of the network they are for. */
export const CHAIN = "AMUSE_EGRESS";

export interface Network {
  /** this network's address range (10.231.250.0/24), if known */
  subnet: string | null;
  /** its gateway, the host, if known */
  gateway: string | null;
  /** whether it has IPv6 (a global address): without, nothing leaves by IPv6 at all */
  v6: boolean;
}

/** Ranges that are not the public internet. */
export const PRIVATE_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
];
export const PRIVATE_V6 = ["::/128", "::1/128", "::ffff:0:0/96", "64:ff9b::/96", "fc00::/7", "fe80::/10", "ff00::/8"];

/** An IPv4 address as a number. */
const toNumber = (address: string) => address.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const toAddress = (n: number) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");

/** An IPv4 range written by its first address (10.231.250.7/24 → 10.231.250.0/24); throws for anything that is not one. */
export function range(cidr: string): string {
  const [address, bits, ...extra] = cidr.trim().split("/");
  const prefix = Number(bits);
  if (address === undefined || !isIPv4(address) || bits === undefined || extra.length > 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
    throw new Error(`"${cidr}" is not an IPv4 address range like 10.231.250.0/24.`);
  const size = 2 ** (32 - prefix);
  return `${toAddress(Math.floor(toNumber(address) / size) * size)}/${prefix}`;
}

/** The rules, as input for iptables-restore and ip6tables-restore. */
export function egressRules({ subnet, gateway, v6 }: Network): { v4: string; v6: string } {
  if (gateway !== null && !isIPv4(gateway)) throw new Error(`"${gateway}" is not an IPv4 address.`);
  const here = [...(gateway === null ? [] : [`${gateway}/32`]), ...(subnet === null ? [] : [range(subnet)])];
  const set = (rules: string[]) =>
    ["*filter", `:${CHAIN} - [0:0]`, `-A OUTPUT -j ${CHAIN}`, ...rules.map((rule) => `-A ${CHAIN} ${rule}`), "COMMIT", ""].join("\n");
  return {
    v4: set([
      "-o lo -j ACCEPT",
      "-d 127.0.0.11/32 -j ACCEPT",
      "-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",
      ...[...here, ...PRIVATE_V4].map((to) => `-d ${to} -j REJECT --reject-with icmp-port-unreachable`),
      "-j ACCEPT",
    ]),
    v6: set(
      v6
        ? [
            "-o lo -j ACCEPT",
            "-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",
            // finding neighbours and the router is how the network works at all
            ...[133, 134, 135, 136].map((type) => `-p ipv6-icmp --icmpv6-type ${type} -j ACCEPT`),
            ...PRIVATE_V6.map((to) => `-d ${to} -j REJECT --reject-with icmp6-port-unreachable`),
            "-j ACCEPT",
          ]
        : ["-o lo -j ACCEPT", "-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT", "-j REJECT --reject-with icmp6-port-unreachable"],
    ),
  };
}

/** The rules of a set that a listing (iptables -S) does not have, in order; none when they are all in place. */
export function missingRules(set: string, listing: string): string[] {
  const have = listing.split("\n").map((line) => line.trim());
  const wanted = set.split("\n").filter((line) => line.startsWith("-A "));
  let from = 0;
  return wanted.filter((rule) => {
    const at = have.indexOf(rule, from);
    if (at < 0) return true;
    from = at + 1;
    return false;
  });
}

/** The default gateway from /proc/net/route's text (the destination 00000000's gateway, little-endian hex); null if there is none. */
export function gatewayOf(route: string): string | null {
  for (const line of route.split("\n").slice(1)) {
    const [, destination, gateway, flags] = line.trim().split(/\s+/);
    if (destination === "00000000" && gateway !== undefined && gateway !== "00000000" && (Number.parseInt(flags ?? "0", 16) & 2) !== 0) {
      const bytes = gateway.match(/../g)?.map((hex) => Number.parseInt(hex, 16));
      return bytes?.length === 4 ? bytes.reverse().join(".") : null;
    }
  }
  return null;
}

/** Whether /proc/net/if_inet6's text lists an address, other than on loopback, that is global (scope 00) or link-local (scope 20). */
export function hasV6(inet6: string): { global: boolean; any: boolean } {
  const lines = inet6.split("\n").filter((line) => line.trim() !== "");
  const outside = lines.map((line) => line.trim().split(/\s+/)).filter(([, , , scope, , device]) => device !== "lo" && scope !== undefined);
  return { global: outside.some(([, , , scope]) => scope === "00"), any: outside.length > 0 };
}
