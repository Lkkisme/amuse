import assert from "node:assert/strict";
import { request } from "node:http";
import type { NetworkInterfaceInfo } from "node:os";
import { test } from "node:test";
import { createHost, type Timers } from "@amuse/core";
import { demoPorts, seed } from "@amuse/demo";
import { type Access } from "./access.ts";
import { type Sources, sandboxReach } from "./sandbox.ts";
import { listen } from "./server.ts";

const nic = (address: string, cidr: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "",
  family: "IPv4",
  mac: "",
  internal,
  cidr,
});

/** The server on the default network (172.19.0.0/16) and on the sandbox's (172.20.0.0/24), the sandbox at 172.20.0.2. */
const sources = (found: string[] = ["172.20.0.2"]): Sources => ({
  resolve: async () => found,
  interfaces: () => ({ lo: [nic("127.0.0.1", "127.0.0.1/8", true)], eth0: [nic("172.19.0.5", "172.19.0.5/16")], eth1: [nic("172.20.0.3", "172.20.0.3/24")] }),
});

test("the sandbox's whole network is refused, whichever way its addresses are written, and no other", async () => {
  const reach = sandboxReach("sandbox", sources());
  assert.equal(reach.refuses("172.20.0.2"), false, "nothing is known until it is looked up");
  assert.equal(await reach.refresh(), 1);
  for (const address of ["172.20.0.2", "172.20.0.9", "172.20.0.1", "::ffff:172.20.0.2", "::FFFF:172.20.0.77"])
    assert.equal(reach.refuses(address), true, address);
  for (const address of ["172.19.0.1", "172.19.0.5", "172.21.0.2", "127.0.0.1", "::1", "fe80::1", "::ffff:172.19.0.1", undefined])
    assert.equal(reach.refuses(address), false, String(address));
});

test("the network is kept when the sandbox is gone, and found again when it comes back with another address", async () => {
  let found = ["172.20.0.2"];
  const reach = sandboxReach("sandbox", { ...sources(), resolve: async () => found });
  await reach.refresh();
  found = [];
  assert.equal(await reach.refresh(), 0);
  assert.equal(reach.refuses("172.20.0.2"), true);
  assert.equal(reach.refuses("172.20.0.200"), true, "recreated with another address on the same network");
});

test("an address on none of the server's networks is refused as that address alone; a failed lookup refuses nothing", async () => {
  const reach = sandboxReach("sandbox", sources(["10.9.9.9"]));
  await reach.refresh();
  assert.equal(reach.refuses("10.9.9.9"), true);
  assert.equal(reach.refuses("10.9.9.10"), false);
  const missing = sandboxReach("sandbox", {
    ...sources(),
    resolve: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(await missing.refresh(), 0);
  assert.equal(missing.refuses("172.20.0.2"), false);
});

/** Lets every request in: whatever is refused is refused for where it comes from. */
const anyone: Access = {
  ready: () => true,
  setup: async () => "",
  login: async () => "session",
  valid: () => true,
  logout: () => {},
  change: async () => null,
};
const never: Timers<number> = { set: () => 0, clear: () => {} };

/** One request from a given local address (127.0.0.x are all this machine), the status it got. */
function ask(port: number, from: string, method: string, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, localAddress: from, method, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    // an accepted upgrade is no response
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.end(method === "POST" ? JSON.stringify({ password: "x" }) : undefined);
  });
}

test("the server refuses every route to the sandbox's network, signed in or not, and serves the rest", async () => {
  const server = await listen({
    session: createHost(demoPorts({ set: (_, fn) => (queueMicrotask(fn), 0), clear: () => {} }), { seed: seed(), timers: never }),
    access: anyone,
    refuse: (address) => address === "127.0.0.2",
    port: 0,
    host: "127.0.0.1",
  });
  try {
    const { port } = server;
    const json = { "content-type": "application/json" };
    const routes: [string, string, Record<string, string>][] = [
      ["GET", "/", {}],
      ["GET", "/unlock", {}],
      ["POST", "/unlock", json],
      ["POST", "/setup", json],
      ["POST", "/password", json],
      ["POST", "/lock", json],
      ["GET", "/files/f-1", {}],
      ["POST", "/files", { "content-type": "image/png", "x-file-name": "a.png" }],
      ["POST", "/transcribe", { "content-type": "audio/webm" }],
      ["GET", "/thumb?id=b1", {}],
      ["GET", "/connected?key=k", {}],
      // the sockets: a would-be /rpc or /live upgrade
      ["GET", "/rpc", { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" }],
      ["GET", "/live?id=b1", { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" }],
    ];
    for (const [method, path, headers] of routes) {
      assert.equal(await ask(port, "127.0.0.2", method, path, headers), 403, `${method} ${path} from the sandbox`);
      assert.notEqual(await ask(port, "127.0.0.1", method, path, headers), 403, `${method} ${path} from anyone else`);
    }
    assert.equal(await ask(port, "127.0.0.1", "GET", "/unlock"), 204);
  } finally {
    await server.close();
  }
});
