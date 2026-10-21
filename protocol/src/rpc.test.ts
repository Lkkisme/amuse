import assert from "node:assert/strict";
import { test } from "node:test";
import { Call, type Handlers, Request, dispatch, empty, results } from "./index.ts";

const handlers: Handlers = {
  "session.sync": async () => ({ kind: "snapshot", state: empty }),
  "session.history": async () => ({ seq: 0, earlier: 0, entities: [] }),
  "chat.send": async ({ text }) => ({ id: `p:${text}` }),
  "chat.stop": async () => null,
  "chat.retry": async () => null,
  "chats.list": async () => ({ chats: [] }),
  "chats.create": async () => ({ id: "c-1", title: "", at: "2026-10-20T08:00:00Z", updated: "2026-10-20T08:00:00Z" }),
  "chats.rename": async () => null,
  "chats.delete": async () => null,
  "approval.resolve": async () => null,
  "connection.begin": async ({ id }) => ({ url: `https://connect.example/${id}` }),
  "connection.dismiss": async () => null,
  "browser.control": async () => null,
  "browser.fit": async () => null,
  "browser.open": async () => ({ id: "b2" }),
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
  "logins.list": async () => ({ sites: [] }),
  "logins.forget": async () => null,
  "sandbox.reset": async () => null,
  "approvals.list": async () => ({ approvals: [] }),
  "goals.list": async () => ({ goals: [] }),
  "goals.get": async () => ({ goal: { id: "g", title: "G", status: "active", muted: false, added: "", about: "", latest: null }, log: [] }),
  "goals.add": async () => ({ id: "g", title: "G", status: "active", muted: false, added: "", about: "", latest: null }),
  "goals.update": async () => null,
  "skills.list": async () => ({ skills: [] }),
  "skills.get": async () => ({ skill: { name: "s", description: "d", origin: "yours", replaced: false }, body: "", files: [] }),
  "skills.remove": async () => null,
  "keys.list": async () => ({ providers: [], models: [], chat: null, browser: null, background: null, thinking: { chat: "off", browser: "off", background: "off" }, voice: { services: [], chosen: null, local: null } }),
  "keys.login": async () => ({ kind: "done" }),
  "keys.answer": async () => ({ kind: "done" }),
  "keys.cancel": async () => null,
  "keys.test": async () => ({ ok: true, detail: "GLM 5.3 Flash answered." }),
  "keys.logout": async () => null,
  "models.choose": async () => null,
  "models.think": async () => null,
  "models.voice": async () => null,
  "models.localVoice": async () => null,
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
