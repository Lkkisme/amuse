/**
 * The sandbox lives in the network namespace of another container (sandbox-net). If that one is restarted, the
 * namespace this one holds is left without its interface, and nothing reaches it any more (it fails closed, never
 * open). Docker cannot rejoin a running container to a new namespace, but it restarts one that exits: so when the
 * network is gone, the daemon ends, and comes back into the new one.
 */
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

/** Whether there is an interface other than loopback with an address. */
export function hasNetwork(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): boolean {
  return Object.values(interfaces).some((list) => list?.some((info) => !info.internal) === true);
}

/** Look every `every` ms; after `misses` looks in a row with no network, call `lost`. Returns how to stop looking. */
export function watchNetwork(
  lost: () => void,
  {
    every = 5_000,
    misses = 3,
    interfaces = networkInterfaces,
  }: { every?: number; misses?: number; interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]> } = {},
): () => void {
  let missed = 0;
  const timer = setInterval(() => {
    missed = hasNetwork(interfaces()) ? 0 : missed + 1;
    if (missed >= misses) {
      clearInterval(timer);
      lost();
    }
  }, every);
  timer.unref();
  return () => clearInterval(timer);
}
