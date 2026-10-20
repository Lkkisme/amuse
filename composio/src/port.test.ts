import assert from "node:assert/strict";
import { test } from "node:test";
import type { Connection, Event } from "@remuse/protocol";
import type { Timers } from "@remuse/core";
import { type AccountStatus, type Composio, composio } from "./client.ts";
import { composioConnector } from "./port.ts";

const connection: Connection = { kind: "connection", id: "c1", at: "2026-10-20T08:00:00Z", provider: "gmail", title: "Gmail", status: "pending" };

/** Timers that run on demand, one tick at a time. */
function ticks() {
  const queue: (() => void)[] = [];
  const timers: Timers<number> = { set: (_, fn) => queue.push(fn), clear: () => {} };
  const tick = async () => {
    queue.shift()?.();
    await new Promise((r) => setImmediate(r));
  };
  return { timers, tick, pending: () => queue.length };
}

const fake = (statuses: AccountStatus[]): Pick<Composio, "link" | "status"> => ({
  link: async (toolkit, user) => ({ url: `https://connect.example/${toolkit}/${user}`, account: "ca_1" }),
  status: async () => statuses.shift() ?? "pending",
});

test("connect returns the hosted link, then marks the connection connected once the account is active", async () => {
  const { timers, tick } = ticks();
  const events: Event[] = [];
  const port = composioConnector(fake(["pending", "pending", "active"]), { userId: "owner", timers });
  assert.equal(await port.connect(connection, (e) => events.push(e)), "https://connect.example/gmail/owner");
  for (let i = 0; i < 3; i++) await tick();
  assert.deepEqual(events, [{ kind: "upserted", entity: { ...connection, status: "connected" } }]);
});

test("a failed account stops the watch; so does the timeout", async () => {
  const failed = ticks();
  composioConnector(fake(["failed"]), { userId: "o", timers: failed.timers }).connect(connection, () => assert.fail("no event"));
  await new Promise((r) => setImmediate(r));
  await failed.tick();
  assert.equal(failed.pending(), 0);

  const slow = ticks();
  await composioConnector(fake([]), { userId: "o", timers: slow.timers, pollMs: 1000, timeoutMs: 3000 }).connect(connection, () => assert.fail("no event"));
  for (let i = 0; i < 3; i++) await slow.tick();
  assert.equal(slow.pending(), 0);
});

test("the client parses Composio's responses and sends the key as x-api-key", async () => {
  const seen: string[] = [];
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname} key=${new Headers(init?.headers).get("x-api-key")}`);
    const body =
      url.pathname.endsWith("/auth_configs") ? { items: [{ id: "ac_1" }] }
      : url.pathname.endsWith("/link") ? { redirect_url: "https://connect.composio.dev/x", connected_account_id: "ca_9" }
      : { id: "ca_9", status: "ACTIVE" };
    return Response.json(body);
  };
  const client = composio("ak_test", http);
  assert.deepEqual(await client.link("gmail", "owner"), { url: "https://connect.composio.dev/x", account: "ca_9" });
  assert.equal(await client.status("ca_9"), "active");
  assert.deepEqual(seen, [
    "GET /api/v3/auth_configs key=ak_test",
    "POST /api/v3/connected_accounts/link key=ak_test",
    "GET /api/v3/connected_accounts/ca_9 key=ak_test",
  ]);
  await assert.rejects(composio("ak_test", async () => Response.json({ nope: 1 })).status("x"), /unexpected shape/);
});

test("tools search, connection check and execute parse Composio's responses", async () => {
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/connected_accounts")) return Response.json({ items: url.searchParams.get("toolkit_slugs") === "gmail" ? [{ id: "ca", status: "ACTIVE" }] : [] });
    if (url.pathname.endsWith("/tools"))
      return Response.json({ items: [{ slug: "GMAIL_FETCH_EMAILS", name: "Fetch", description: "Fetch emails", input_parameters: { properties: { max_results: { type: "integer" } }, required: [] } }] });
    assert.equal(init?.method, "POST");
    return Response.json({ successful: true, data: { messages: [] }, error: null });
  };
  const client = composio("ak_test", http);
  assert.equal(await client.connected("gmail", "owner"), true);
  assert.equal(await client.connected("slack", "owner"), false);
  assert.deepEqual(await client.tools("gmail", "latest"), [
    { slug: "GMAIL_FETCH_EMAILS", name: "Fetch", description: "Fetch emails", parameters: { max_results: { type: "integer" } }, required: [] },
  ]);
  assert.deepEqual(await client.execute("GMAIL_FETCH_EMAILS", "owner", {}), { ok: true, data: { messages: [] } });
});
