/**
 * The mark that the network rules are in. Compose starts the sandbox after sandbox-net is healthy, but Docker's own
 * restarts (a reboot, a restart of dockerd, a crash) do not wait for that, and the sandbox may be running while
 * sandbox-net is still putting its rules in. So the sandbox does not wait for compose: sandbox-net writes this
 * mark, on a volume the sandbox can only read, once the rules are verified, and takes it away first thing when
 * it starts; the sandbox starts nothing until it is there, and ends if it goes. The mark says which network it is
 * for (the namespace both share), so one left from an earlier network is no mark at all.
 */
import { readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";

/** The network namespace this process is in, as the kernel names it (net:[4026532812]). */
export const netns = () => readlinkSync("/proc/self/ns/net");

/** Whether the mark at `file` is there and for this network. */
export function isReady(file: string, ns: string = netns()): boolean {
  try {
    return readFileSync(file, "utf8").trim() === ns;
  } catch {
    return false;
  }
}

/** Put the mark for this network, whole or not at all. */
export function markReady(file: string, ns: string = netns()): void {
  writeFileSync(`${file}.next`, `${ns}\n`);
  renameSync(`${file}.next`, file);
}

export function unmark(file: string): void {
  rmSync(file, { force: true });
  rmSync(`${file}.next`, { force: true });
}

/** Resolves once the mark is there; `waiting` is called with every look that finds none after the first. */
export async function untilReady(
  file: string,
  { every = 500, ns = netns, waiting = () => {} }: { every?: number; ns?: () => string; waiting?: () => void } = {},
): Promise<void> {
  for (let looks = 0; !isReady(file, ns()); looks++) {
    if (looks > 0) waiting();
    await new Promise((done) => setTimeout(done, every));
  }
}

/** Look every `every` ms; as soon as the mark is gone (or is for another network), call `lost`. Returns how to stop looking. */
export function watchReady(file: string, lost: () => void, { every = 1_000, ns = netns }: { every?: number; ns?: () => string } = {}): () => void {
  const timer = setInterval(() => {
    if (isReady(file, ns())) return;
    clearInterval(timer);
    lost();
  }, every);
  timer.unref();
  return () => clearInterval(timer);
}
