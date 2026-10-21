import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import { test } from "node:test";
import { hasNetwork, watchNetwork } from "./watch.ts";

const nic = (internal: boolean): NetworkInterfaceInfo => ({
  address: internal ? "127.0.0.1" : "10.231.250.2",
  netmask: "",
  family: "IPv4",
  mac: "",
  internal,
  cidr: null,
});

test("a network is an interface that is not loopback", () => {
  assert.equal(hasNetwork({ lo: [nic(true)] }), false);
  assert.equal(hasNetwork({}), false);
  assert.equal(hasNetwork({ lo: [nic(true)], eth0: [nic(false)] }), true);
  assert.equal(hasNetwork({ eth0: undefined }), false);
});

test("the daemon ends once the network has been gone for a few looks in a row, not for one", async () => {
  let up = true;
  let lost = 0;
  const stop = watchNetwork(() => lost++, { every: 5, misses: 3, interfaces: () => (up ? { eth0: [nic(false)] } : { lo: [nic(true)] }) });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(lost, 0, "while it is there");
  up = false;
  await new Promise((r) => setTimeout(r, 7));
  up = true; // back before the third look
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(lost, 0, "a blip is no loss");
  up = false;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(lost, 1, "gone for good, said once");
  stop();
});
