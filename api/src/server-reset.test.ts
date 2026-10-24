import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { test } from "node:test";
import { createHost, type Timers } from "@amuse/core";
import { demoPorts } from "@amuse/demo";
import { letIn, noPin } from "./testing.ts";
import { listen } from "./server.ts";

const timers: Timers<number> = { set: () => 0, clear: () => {} };
const anyone = letIn();
const upgrade = "GET /rpc HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";

test("a malformed WebSocket frame closes only its connection and the server keeps serving", async (t) => {
  const server = await listen({ session: createHost(demoPorts(timers), { timers }), access: anyone, ...noPin, port: 0, host: "127.0.0.1" });
  t.after(() => server.close());
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(server.port, "127.0.0.1", () => socket.write(upgrade));
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("server did not close an invalid WebSocket")); }, 3000);
    socket.on("error", () => {});
    socket.on("close", () => { clearTimeout(timeout); resolve(); });
    socket.once("data", (data) => {
      assert.match(data.toString(), /101 Switching Protocols/);
      // RFC 6455 requires client masking; this real TCP peer violates it.
      socket.write(Buffer.from([0x81, 0x01, 0x41]));
      socket.resume();
    });
    socket.on("data", () => {});
  });
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/unlock`)).status, 204);
});

test("resetting rejected upgrades cannot take down the HTTP listener", async (t) => {
  const server = await listen({ session: createHost(demoPorts(timers), { timers }), access: { ...anyone, valid: () => false }, ...noPin, port: 0, host: "127.0.0.1" });
  t.after(() => server.close());
  await Promise.all(Array.from({ length: 20 }, () => new Promise<void>((resolve) => {
    const socket = createConnection(server.port, "127.0.0.1", () => {
      socket.write(upgrade, () => socket.resetAndDestroy());
    });
    socket.on("error", () => {});
    socket.on("close", () => resolve());
  })));
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/unlock`)).status, 401);
});
