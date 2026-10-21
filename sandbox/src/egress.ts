/**
 * What the sandbox may reach: the public internet, and nothing else. The rules are the sandbox's own network
 * namespace's OUTPUT chain, installed by the container that owns that namespace (net.ts) and out of reach of
 * the sandbox, which has no NET_ADMIN even as root. New or old, a connection to anything private is refused at
 * once, whatever its state: the host (its gateway, and every address of its own on a private range), the LAN,
 * Tailscale and other VPN peers (100.64.0.0/10), the ranges proxy tools on the host hand out as fake addresses
 * (198.18.0.0/15), link-local, loopback off the loopback interface, multicast and reserved ranges, and this
 * network itself. The one thing let through to this network is the reply to a connection the Amuse server
 * opened (direction REPLY), so the server reaches any port the sandbox listens on; the sandbox opens nothing
 * there. Everything else is the public internet. DNS goes to Docker's resolver on loopback (which asks the
 * host's own DNS: names of the LAN can be looked up, nothing of it can be reached).
 * IPv6 is refused altogether, unless it is turned on, and then held to the same rules.
 */
import { isIPv4 } from "node:net";

/** The chain the rules are in, and what is true of the network they are for. */
export const CHAIN = "AMUSE_EGRESS";

export interface Network {
  /** this network's address range (10.231.250.0/24), if known */
  subnet: string | null;
  /** its gateway, the host, if known */
  gateway: string | null;
  /** IPv6 turned on: this network's own ranges and gateways, to refuse like IPv4's; null: no IPv6 egress at all */
  v6: { subnets: string[]; gateways: string[] } | null;
}

/** Ranges that are not the public internet. */
export const PRIVATE_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
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

/** An IPv6 address of 32 hex digits, written out in full (fd00:0:0:0:0:0:0:2). */
function v6Text(hex: string): string {
  return (hex.match(/.{4}/g) ?? []).map((group) => Number.parseInt(group, 16).toString(16)).join(":");
}

/** The IPv6 ranges and gateways of a namespace, from /proc/net/if_inet6 and /proc/net/ipv6_route: the global addresses' ranges, the default routes' next hops. */
export function v6Of(inet6: string, routes: string): { subnets: string[]; gateways: string[] } {
  const subnets = inet6
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([address, , prefix, scope, , device]) => {
      if (address?.length !== 32 || device === "lo" || scope !== "00") return [];
      const bits = Number.parseInt(prefix ?? "", 16);
      if (!Number.isInteger(bits) || bits > 128) return [];
      const size = 2n ** BigInt(128 - bits);
      const first = (BigInt(`0x${address}`) / size) * size;
      return [`${v6Text(first.toString(16).padStart(32, "0"))}/${bits}`];
    });
  const gateways = routes
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([destination, prefix, , , next]) =>
      destination === "0".repeat(32) && prefix === "00" && next?.length === 32 && next !== "0".repeat(32) ? [v6Text(next)] : [],
    );
  return { subnets: [...new Set(subnets)], gateways: [...new Set(gateways)] };
}

/** An IPv6 range, checked to be one (fd00:0:0:0:0:0:0:0/64). */
function v6Range(cidr: string): string {
  const [address, bits, ...extra] = cidr.split("/");
  const prefix = Number(bits);
  if (
    address === undefined ||
    !/^[0-9a-f:]+$/.test(address) ||
    address.split(":").length !== 8 ||
    bits === undefined ||
    extra.length > 0 ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 128
  )
    throw new Error(`"${cidr}" is not an IPv6 address range.`);
  return cidr;
}
const v6Address = (address: string) => v6Range(`${address}/128`).slice(0, -4);

const REPLIES = "-m conntrack --ctstate RELATED,ESTABLISHED --ctdir REPLY -j ACCEPT";

/** A whole filter table, atomically replacing the one there: the chain, and a jump to it from OUTPUT. */
function table(rules: string[]): string {
  return [
    "*filter",
    ":INPUT ACCEPT [0:0]",
    ":FORWARD ACCEPT [0:0]",
    ":OUTPUT ACCEPT [0:0]",
    `:${CHAIN} - [0:0]`,
    `-A OUTPUT -j ${CHAIN}`,
    ...rules.map((rule) => `-A ${CHAIN} ${rule}`),
    "COMMIT",
    "",
  ].join("\n");
}

/** The first thing put in: nothing new leaves (nor anything else), loopback excepted, until the real rules are in. */
export function blanketRules(): { v4: string; v6: string } {
  return {
    v4: table(["-o lo -j ACCEPT", "-j REJECT --reject-with icmp-port-unreachable"]),
    v6: table(["-o lo -j ACCEPT", "-j REJECT --reject-with icmp6-port-unreachable"]),
  };
}

/** The rules, as input for iptables-restore and ip6tables-restore. */
export function egressRules({ subnet, gateway, v6 }: Network): { v4: string; v6: string } {
  if (gateway !== null && !isIPv4(gateway)) throw new Error(`"${gateway}" is not an IPv4 address.`);
  const network = subnet === null ? null : range(subnet);
  const reject = "-j REJECT --reject-with icmp-port-unreachable";
  const refuse6 = "-j REJECT --reject-with icmp6-port-unreachable";
  const own6 = v6 === null ? [] : [...v6.subnets.map(v6Range), ...v6.gateways.map((address) => `${v6Address(address)}/128`)];
  return {
    v4: table([
      "-o lo -j ACCEPT",
      "-d 127.0.0.11/32 -j ACCEPT",
      // the Amuse server's connections to the sandbox: this network's one exception, and only for replies to them
      network === null ? REPLIES : `-d ${network} ${REPLIES}`,
      ...[...(gateway === null ? [] : [`${gateway}/32`]), ...(network === null ? [] : [network]), ...PRIVATE_V4].map((to) => `-d ${to} ${reject}`),
      "-j ACCEPT",
    ]),
    v6: table(
      v6 === null
        ? ["-o lo -j ACCEPT", refuse6]
        : [
            "-o lo -j ACCEPT",
            // finding neighbours and the router is how the network works at all
            ...[133, 134, 135, 136].map((type) => `-p ipv6-icmp --icmpv6-type ${type} -j ACCEPT`),
            ...v6.subnets.map((to) => `-d ${v6Range(to)} ${REPLIES}`),
            ...[...own6, ...PRIVATE_V6].map((to) => `-d ${to} ${refuse6}`),
            "-j ACCEPT",
          ],
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
