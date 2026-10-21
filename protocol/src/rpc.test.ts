import assert from "node:assert/strict";
import { test } from "node:test";
import { Call, type Handlers, Request, dispatch, empty, results } from "./index.ts";

const handlers: Handlers = {
  "session.sync": async () => ({ kind: "snapshot", state: empty }),
  "session.history": async () => ({ seq: 0, earlier: 0, entities: [] }),
  "chat.send": async ({ text }) => ({ id: `p:${text}` }),
  "chat.stop": async () => null,
  "chats.list": async () => ({ chats: [] }),
  "chats.create": async () => ({ id: "c-1", title: "", at: "2026-10-20T08:00:00Z", updated: "2026-10-20T08:00:00Z" }),
  "chats.rename": async () => null,
  "chats.delete": async () => null,
  "approval.resolve": async () => null,
  "connection.begin": async ({ id }) => ({ url: `https://connect.example/${id}` }),
  "connection.dismiss": async () => null,
  "browser.control": async () => null,
  "browser.fit": async () => null,
  "task.stop": async () => null,
  "schedules.list": async () => ({ schedules: [] }),
  "schedule.control": async () => null,
  "apps.search": async () => ({ apps: [], cursor: null }),
  "apps.accounts": async () => ({ accounts: [] }),
  "apps.connect": async ({ app }) => ({ url: `https://connect.example/${app}` }),
  "apps.disconnect": async () => null,
  "apps.permissions": async () => ({ rules: [] }),
  "apps.permit": async () => null,
  "sites.rules": async () => ({ rules: [] }),
  "sites.permit": async () => null,
};

test("a framed request parses into a typed call and dispatches to its handler", async () => {
  const frame = Request.parse({ jsonrpc: "2.0", id: 1, method: "chat.send", params: { chat: "main", text: "hi", timezone: "UTC", attachments: [] } });
  const call = Call.parse({ method: frame.method, params: frame.params });
  const result = await dispatch(handlers, call);
  assert.deepEqual(result, { id: "p:hi" });
  assert.deepEqual(results[call.method].parse(result), result);
});

test("unknown methods and bad params are rejected by Call, not by framing", () => {
  const unknown = Request.parse({ jsonrpc: "2.0", id: 2, method: "chat.nope", params: {} });
  assert.equal(Call.safeParse({ method: unknown.method, params: unknown.params }).success, false);
  assert.equal(Call.safeParse({ method: "chat.send", params: { chat: "main", text: "", timezone: "UTC", attachments: [] } }).success, false);
  assert.equal(Call.safeParse({ method: "browser.control", params: { id: "b1", action: "fly" } }).success, false);
});
