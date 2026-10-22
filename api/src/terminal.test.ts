import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { TERMINAL_CLOSED, attachTerminal } from "./terminal.ts";

const portOf = (address: string | AddressInfo | null) => (typeof address === "object" && address !== null ? address.port : 0);

/** A daemon's terminal that records what reaches it and closes with `code` when told "bye"; and a viewer relayed to it. */
async function relayed(code = 1000) {
  const reached: { text: string; binary: boolean }[] = [];
  const daemon = new WebSocketServer({ port: 0 });
  daemon.on("connection", (ws) => {
    ws.send(Buffer.from("screen"), { binary: true });
    ws.send("words of the daemon's");
    ws.on("message", (data: Buffer, binary: boolean) => {
      reached.push({ text: data.toString("utf8"), binary });
      if (data.toString("utf8") === "bye") ws.close(code, "the daemon's own reason");
    });
  });
  await new Promise((done) => daemon.once("listening", done));
  const daemonPort = portOf(daemon.address());
  const server = createServer();
  const viewers = new WebSocketServer({ server });
  viewers.on("connection", (ws) => attachTerminal(ws, `ws://127.0.0.1:${daemonPort}/terminal`));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const viewer = new WebSocket(`ws://127.0.0.1:${portOf(server.address())}`);
  const shown: { text: string; binary: boolean }[] = [];
  viewer.on("message", (data: Buffer, binary: boolean) => shown.push({ text: data.toString("utf8"), binary }));
  const closed = new Promise<{ code: number; reason: string }>((done) => viewer.once("close", (c, r) => done({ code: c, reason: r.toString() })));
  await new Promise((done) => viewer.once("open", done));
  const stop = () => {
    daemon.close();
    viewers.close();
    server.close();
  };
  return { viewer, shown, reached, closed, stop };
}

const until = async (done: () => boolean, ms = 3_000) => {
  for (const start = Date.now(); !done() && Date.now() - start < ms; ) await new Promise((r) => setTimeout(r, 10));
  return done();
};

test("bytes go both ways; of the viewer's words only a resize passes, and none of the daemon's", async () => {
  const { viewer, shown, reached, closed, stop } = await relayed();
  viewer.send(Buffer.from("typed"));
  viewer.send(JSON.stringify({ type: "resize", cols: 120, rows: 40, extra: "dropped" }));
  viewer.send(JSON.stringify({ type: "run", command: "rm -rf ~" }));
  viewer.send("not json");
  viewer.send(Buffer.from("bye"));
  assert.equal((await closed).code, TERMINAL_CLOSED.ended);
  assert.deepEqual(reached, [
    { text: "typed", binary: true },
    { text: JSON.stringify({ type: "resize", cols: 120, rows: 40 }), binary: false },
    { text: "bye", binary: true },
  ]);
  assert.deepEqual(shown, [{ text: "screen", binary: true }]);
  stop();
});

test("how the daemon closed reaches the viewer as a code, in this server's words", async () => {
  for (const [daemonCode, code] of [
    [4404, TERMINAL_CLOSED.none],
    [4429, TERMINAL_CLOSED.full],
    [4503, TERMINAL_CLOSED.away],
    [1011, TERMINAL_CLOSED.ended],
  ]) {
    const { viewer, shown, closed, stop } = await relayed(daemonCode);
    assert.ok(await until(() => shown.length > 0));
    viewer.send(Buffer.from("bye"));
    const { code: got, reason } = await closed;
    assert.equal(got, code);
    assert.ok(!reason.includes("daemon"));
    stop();
  }
});

test("a daemon that cannot be reached closes the viewer as away", async () => {
  const server = createServer();
  const viewers = new WebSocketServer({ server });
  viewers.on("connection", (ws) => attachTerminal(ws, "ws://127.0.0.1:1/terminal"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const viewer = new WebSocket(`ws://127.0.0.1:${portOf(server.address())}`);
  const code = await new Promise<number>((done) => viewer.once("close", done));
  assert.equal(code, TERMINAL_CLOSED.away);
  viewers.close();
  server.close();
});
