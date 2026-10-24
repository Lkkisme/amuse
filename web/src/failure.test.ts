/**
 * Settings › Permissions over a socket that drops (the server restarts): the page loads its rules the way
 * SitePermissions does and says what failed with `wordsFor`. The session waits out the reconnect and sends the
 * calls again, so the page has nothing to say; and a call that cannot be repeated says the server cannot be
 * reached, in the app's words, never the transport's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { z } from "zod";
import { connect } from "@amuse/api/client";
import { activeT } from "./i18n/language.ts";
import { wordsFor } from "./shown.ts";

const Asked = z.object({ id: z.number().optional() });

async function server() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  const sockets = new Set<ServerSocket>();
  let quiet = false;
  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (data) => {
      const asked = Asked.parse(JSON.parse(data.toString()));
      if (quiet || asked.id === undefined) return;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: asked.id, result: { rules: [], chats: [] } }));
    });
  });
  const address = wss.address();
  return {
    url: `ws://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/rpc`,
    quiet: (on: boolean) => void (quiet = on),
    drop: () => sockets.forEach((ws) => ws.terminate()),
    close: () => new Promise((resolve) => wss.close(() => resolve(undefined))),
  };
}

const t = activeT();

test("Permissions after a drop and reconnect: the page loads and shows no error", async () => {
  const at = await server();
  const session = connect(at.url, { unreachable: () => t.common.serverUnreachable });
  try {
    await session.call("browser.rules", {});
    at.quiet(true);
    const loading = Promise.all([session.call("browser.rules", {}), session.call("sites.rules", {})]).then(
      () => null,
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    at.quiet(false);
    at.drop();
    assert.equal(wordsFor(await loading, t), null);
  } finally {
    session.close();
    await at.close();
  }
});

test("a call that cannot be repeated shows the translated unreachable text, not the transport's", async () => {
  const at = await server();
  const session = connect(at.url, { unreachable: () => t.common.serverUnreachable });
  try {
    await session.call("browser.rules", {});
    at.quiet(true);
    const sending = session.call("chats.create", {}).catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 50));
    at.drop();
    const words = wordsFor(await sending, t);
    assert.equal(words, t.common.serverUnreachable);
    assert.notEqual(words, "the connection dropped");
  } finally {
    session.close();
    await at.close();
  }
});
