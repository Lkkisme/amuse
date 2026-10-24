/**
 * Explicit local owner provisioning for the Android USB pairing receiver.
 * This module has no HTTP/RPC entry point and never changes an existing phone
 * token. It creates one trusted, revocable device/session in the migrated
 * database and writes the token only to a caller-selected new private file.
 *
 * node api/src/pair-device.ts --data <folder> --server <https-origin> --output <private-json> [--name <device>]
 * Existing authenticated phones need no new pairing after the JSON migration.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Db, transaction } from "@amuse/db";
import { MAX_SESSIONS, digest } from "./access.ts";
import { locate, openExisting } from "./data.ts";
import { createFile } from "./durable.ts";

export interface PairDeviceOptions {
  /** An existing private directory, and a new file: an earlier file is never replaced. */
  output: string;
  serverOrigin: string;
  name?: string;
}

/** Safe public metadata only. The token is deliberately absent from the return value. */
export interface PairedDevice {
  deviceId: string;
  output: string;
  serverOrigin: string;
}

function originOf(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The server must be an HTTPS origin."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Use an HTTPS server origin, without a path, credentials, query or fragment (HTTP is allowed only on loopback).");
  return url.origin;
}

export function pairDeviceToFile(db: Db, options: PairDeviceOptions): PairedDevice {
  const serverOrigin = originOf(options.serverOrigin);
  if (!isAbsolute(options.output)) throw new Error("The private output file must have an absolute path.");
  const output = resolve(options.output);
  if (!existsSync(dirname(output)) || !lstatSync(dirname(output)).isDirectory()) throw new Error("The private output directory must already exist.");
  if (existsSync(output) || lstatSync(output, { throwIfNoEntry: false })) throw new Error("The output file already exists; it will not be replaced.");
  if (!db.prepare("select 1 as ready from access where id = 1").get()) throw new Error("Set up the owner's instance before pairing a device.");
  const name = options.name?.trim() || "Owner-paired Android device";
  const deviceId = `paired-${randomUUID()}`;
  const sessionToken = randomBytes(32).toString("base64url");
  const payload = JSON.stringify({ serverOrigin, sessionToken, deviceId }, null, 2);
  let published = false;
  try {
    return transaction(db, () => {
      const at = new Date().toISOString();
      // A device cookie is made by the first authenticated request (the same
      // path migrated, previously signed-in sessions use). Android provisions
      // only amuse=<session>, so no new receiver capability is required.
      db.prepare("insert into devices (id, digest, trusted, asked, agent, address, at, seen) values (?, null, 1, null, ?, 'local owner pairing', ?, ?)").run(deviceId, name.slice(0, 300), at, at);
      db.prepare("insert into sessions (digest, device) values (?, ?)").run(digest(sessionToken), deviceId);
      db.prepare("delete from sessions where position not in (select position from sessions order by position desc limit ?)").run(MAX_SESSIONS);
      // Do not replace a file created by another owner operation in the gap.
      if (!createFile(output, payload, 0o600)) throw new Error("The output file already exists; it will not be replaced.");
      published = true;
      return { deviceId, output, serverOrigin };
    });
  } catch (error) {
    // If the commit itself failed, discard only this operation's exact newly
    // written file. A caller's existing/replaced file is always left alone.
    if (published) {
      try {
        const found = lstatSync(output, { throwIfNoEntry: false });
        if (found?.isFile() && !found.isSymbolicLink() && readFileSync(output, "utf8") === payload) unlinkSync(output);
      } catch { /* the private output may need owner cleanup after an I/O failure */ }
    }
    throw error;
  }
}

export async function pairDeviceCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<PairedDevice> {
  const args = new Map<string, string>();
  for (let at = 0; at < argv.length; at += 2) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (!flag || !["--data", "--server", "--output", "--name"].includes(flag) || !value || value.startsWith("--") || args.has(flag))
      throw new Error("usage: pair-device --data <folder> --server <https-origin> --output <new-private-json> [--name <device>]");
    args.set(flag, value);
  }
  const data = args.get("--data");
  const serverOrigin = args.get("--server");
  const output = args.get("--output");
  if (!data || !serverOrigin || !output) throw new Error("Explicit --data, --server and --output are required; no existing pairing file is replaced.");
  // Opening an existing current-schema DB runs no migration, imports no file,
  // and contacts no running service. SQLite supplies its normal writer lock.
  const where = locate({ ...env, AMUSE_DATA: resolve(data), AMUSE_JOURNAL: undefined });
  const db = await openExisting(where);
  try {
    return pairDeviceToFile(db, { serverOrigin, output: resolve(output), ...(args.has("--name") ? { name: args.get("--name")! } : {}) });
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const paired = await pairDeviceCli(process.argv.slice(2));
    console.log(JSON.stringify({ paired: true, ...paired, credentials: "written only to the private output file" }));
  } catch (error) {
    console.error(`Pairing was not created: ${error instanceof Error ? error.message : "local operation failed"}`);
    process.exitCode = 1;
  }
}
