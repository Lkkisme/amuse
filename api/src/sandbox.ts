/**
 * Keeping the sandbox away from this server. The sandbox shares one network
 * with the server, and nothing else is on it, so any request from that
 * network's addresses is the sandbox's (or the host's, at that network's
 * gateway): the server turns all of it away, signed in or not, whatever
 * route it asks for. The network is found from the sandbox's name: its
 * address, then the network of the server's own that the address is on. A
 * recreated sandbox may get another address on that network, so the network
 * is what is kept, and kept even if the sandbox is gone for a while.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIPv4 } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

export interface Reach {
  /** Whether a request from this remote address comes from the sandbox's network. */
  refuses(address: string | undefined): boolean;
  /** Look the sandbox up again; how many addresses it has now (none: not up, or not found). */
  refresh(): Promise<number>;
}

export interface Sources {
  /** The addresses a host name has. */
  resolve(host: string): Promise<string[]>;
  /** The server's own network interfaces. */
  interfaces(): NodeJS.Dict<NetworkInterfaceInfo[]>;
}

const real: Sources = {
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  interfaces: networkInterfaces,
};

/** An IPv4 address a dual-stack socket reports in IPv6 form (::ffff:172.20.0.2), as plain IPv4. */
const plain = (address: string) => (address.toLowerCase().startsWith("::ffff:") && isIPv4(address.slice(7)) ? address.slice(7) : address);

const family = (address: string) => (isIPv4(address) ? "ipv4" : "ipv6");

export function sandboxReach(host: string, sources: Sources = real): Reach {
  const refused = new BlockList();
  return {
    refuses: (address) => address !== undefined && refused.check(plain(address), family(plain(address))),
    async refresh() {
      const found = await sources.resolve(host).catch(() => []);
      const own = Object.values(sources.interfaces()).flatMap((list) => list ?? []);
      for (const address of found) {
        refused.addAddress(address, family(address));
        // the whole network the address is on, as the server sees it
        for (const mine of own) {
          const [net, bits] = mine.cidr?.split("/") ?? [];
          if (mine.internal || net === undefined || bits === undefined || family(net) !== family(address)) continue;
          const subnet = new BlockList();
          subnet.addSubnet(net, Number(bits), family(net));
          if (subnet.check(address, family(address))) refused.addSubnet(net, Number(bits), family(net));
        }
      }
      return found.length;
    },
  };
}
