/**
 * Keeping the sandbox away from this server. The sandbox shares one network
 * with the server (compose gives it a fixed subnet), and nothing else is on
 * it, so any request from that network's addresses is the sandbox's, or the
 * host's at that network's gateway: the server turns all of it away, signed in
 * or not, whatever route it asks for, from its first request. The subnet is
 * given, not looked for, so nothing has to be learned while the sandbox comes
 * up, and a server that is told one it cannot read does not start.
 */
import { BlockList, isIP } from "node:net";

/** A remote address, with an IPv4 one a dual-stack socket reports as IPv6 (::ffff:10.0.0.2) written as plain IPv4. */
const plain = (address: string) => (address.toLowerCase().startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address);

/** Whether a request from this remote address comes from `subnet` ("10.231.250.0/24"); throws, in words, for a subnet it cannot read. */
export function refusing(subnet: string): (address: string | undefined) => boolean {
  const [net, bits, ...extra] = subnet.trim().split("/");
  const version = net === undefined ? 0 : isIP(net);
  const prefix = Number(bits);
  if (version === 0 || extra.length > 0 || bits === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > (version === 4 ? 32 : 128))
    throw new Error(`The sandbox's subnet "${subnet}" is not an address range like 10.231.250.0/24.`);
  const blocked = new BlockList();
  blocked.addSubnet(net ?? "", prefix, version === 4 ? "ipv4" : "ipv6");
  return (address) => {
    if (address === undefined) return false;
    const there = plain(address);
    const kind = isIP(there);
    return kind !== 0 && blocked.check(there, kind === 4 ? "ipv4" : "ipv6");
  };
}
