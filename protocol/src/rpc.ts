/**
 * Client → server: JSON-RPC 2.0 over one WebSocket. Calls are a union on
 * `method`; results are keyed by method and checked for exhaustiveness with
 * `satisfies`. The server pushes `event` notifications (see events.ts).
 * Live browser pixels are not JSON-RPC; they stream on their own channel.
 */
import { z } from "zod";
import { Account, App, KindRule, Permission, Site, SiteRule, ToolKind } from "./apps.ts";
import { Approval, Attachment, Id, Resolution, Schedule, TimeZone } from "./entities.ts";
import { Envelope, Index, Page, Seq, State } from "./events.ts";
import { Chat, Push } from "./chats.ts";
import { KeyTest, KeysState, LoginStep, ModelRef, ModelRole, ThinkingLevel } from "./keys.ts";

const call = <M extends string, P extends z.ZodObject>(method: M, params: P) =>
  z.object({ method: z.literal(method), params });

export const Call = z.discriminatedUnion("method", [
  /** Catch up on a chat from `since` (null: from nothing). */
  call("session.sync", z.object({ chat: Id, since: Seq.nullable() })),
  /** Up to `limit` of a chat's entities just before feed index `before`, for a state holding only the recent end. */
  call("session.history", z.object({ chat: Id, before: Index, limit: z.int().min(1).max(200) })),
  /** `timezone`: the device's (Intl), so times are the user's own */
  call(
    "chat.send",
    z
      .object({ chat: Id, text: z.string(), timezone: TimeZone, attachments: z.array(Attachment).max(10) })
      .refine((p) => p.text.trim() !== "" || p.attachments.length > 0, "Say something or attach a file"),
  ),
  /** Stop the agent's current reply in a chat. */
  call("chat.stop", z.object({ chat: Id })),
  /** Try again the turn Muse could not reply to (a Failure, by id). */
  call("chat.retry", z.object({ id: Id })),
  /** The chats there are: the main chat first, then side chats, most recently used first. */
  call("chats.list", z.object({})),
  /** Open a side chat; it is named after its first message. */
  call("chats.create", z.object({})),
  call("chats.rename", z.object({ id: Id, title: z.string().trim().min(1).max(80) })),
  /** Delete a side chat for good, stopping whatever runs in it. */
  call("chats.delete", z.object({ id: Id })),
  call("approval.resolve", z.object({ id: Id, resolution: Resolution })),
  /** Start connecting: returns the provider's hosted auth link. */
  call("connection.begin", z.object({ id: Id })),
  call("connection.dismiss", z.object({ id: Id })),
  /** take: → paused (user in control); handBack: → working; stop: → stopped. */
  call("browser.control", z.object({ id: Id, action: z.enum(["take", "handBack", "stop"]) })),
  /** While the user views a browser: shape its desktop like their view (CSS px); null: back to the standard size. */
  call(
    "browser.fit",
    z.object({ id: Id, view: z.object({ width: z.int().min(200).max(8000), height: z.int().min(200).max(8000) }).nullable() }),
  ),
  /** Open a browser of the user's own, held by them from the start, in a chat; it counts against the browsers there are. */
  call("browser.open", z.object({ chat: Id, url: z.url() })),
  call("task.stop", z.object({ id: Id })),
  /** Every schedule there is (the feed a client holds may not reach back to them), newest first. */
  call("schedules.list", z.object({})),
  /** pause: stop running it until resumed; resume: run it again from now on; cancel: for good. */
  call("schedule.control", z.object({ id: Id, action: z.enum(["pause", "resume", "cancel"]) })),
  /** Apps to connect: the most used first; `query` narrows them; `cursor` (from a result) goes on. */
  call("apps.search", z.object({ query: z.string().max(100), cursor: z.string().nullable() })),
  /** The accounts connected so far. */
  call("apps.accounts", z.object({})),
  /** Start connecting `app`: returns the provider's hosted auth link. */
  call("apps.connect", z.object({ app: Id })),
  call("apps.disconnect", z.object({ account: Id })),
  /** What the agent may do with an app: reading, changing, destroying (its tools sorted by their own hints). */
  call("apps.permissions", z.object({ app: Id })),
  /** Set what the agent may do with an app's tools of one kind; null: back to the default. */
  call("apps.permit", z.object({ app: Id, kind: ToolKind, permission: Permission.nullable() })),
  /** The sites the user has set a rule for (every other site: ask). */
  call("sites.rules", z.object({})),
  /** Set what the browser agent may do on a site; null: back to the default (ask). */
  call("sites.permit", z.object({ site: Site, permission: Permission.nullable() })),
  /** The sites the browsers keep logins for (from the user's own sign-ins), with how many cookies. */
  call("logins.list", z.object({})),
  /** Sign the browsers out of a site: its kept logins go, from every open browser too. */
  call("logins.forget", z.object({ site: z.string().min(1).max(253) })),
  /** Every approval asked in any chat, newest first, with the chat it is in: what was allowed or denied, and when. */
  call("approvals.list", z.object({})),
  /** The providers there are for keys, which are set up, the models they offer and the ones chosen. */
  call("keys.list", z.object({})),
  /** Start setting up a provider's key: its first prompt (or done/failed). */
  call("keys.login", z.object({ provider: z.string().min(1).max(100) })),
  /** Answer a sign-in's prompt: the next one (or done/failed). */
  call("keys.answer", z.object({ login: z.string().min(1).max(100), value: z.string().max(8192) })),
  call("keys.cancel", z.object({ login: z.string().min(1).max(100) })),
  /** Try a provider's key: one short request with it (a model of theirs; the apps' directory for Composio). */
  call("keys.test", z.object({ provider: z.string().min(1).max(100) })),
  /** Forget a provider's key. */
  call("keys.logout", z.object({ provider: z.string().min(1).max(100) })),
  /** Choose the model Muse chats with, or the one that works in the browser (it must see pictures). */
  /** null: back to the default (only the background's: the chat's model) */
  call("models.choose", z.object({ role: ModelRole, model: ModelRef.nullable() })),
  /** How much the chat's or the browser's model thinks (one of the levels its model takes). */
  call("models.think", z.object({ role: ModelRole, level: ThinkingLevel })),
  /** Which speech service turns the mic into text (by provider); null: the first one with a key. */
  call("models.voice", z.object({ provider: z.string().min(1).max(100).nullable() })),
]);

export type Call = z.infer<typeof Call>;
export type Method = Call["method"];

const done = z.null();

export const results = {
  /** Events since `since` when the server still has them, else a snapshot of the recent end of the feed. */
  "session.sync": z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("events"), events: z.array(Envelope) }),
    z.object({ kind: z.literal("snapshot"), state: State }),
  ]),
  "session.history": Page,
  "chat.send": z.object({ id: Id }),
  "chat.stop": done,
  "chat.retry": done,
  "chats.list": z.object({ chats: z.array(Chat) }),
  "chats.create": Chat,
  "chats.rename": done,
  "chats.delete": done,
  "approval.resolve": done,
  "connection.begin": z.object({ url: z.url() }),
  "connection.dismiss": done,
  "browser.control": done,
  "browser.fit": done,
  "browser.open": z.object({ id: Id }),
  "task.stop": done,
  "schedules.list": z.object({ schedules: z.array(Schedule) }),
  "schedule.control": done,
  "apps.search": z.object({ apps: z.array(App), cursor: z.string().nullable() }),
  "apps.accounts": z.object({ accounts: z.array(Account) }),
  "apps.connect": z.object({ url: z.url() }),
  "apps.disconnect": done,
  "apps.permissions": z.object({ rules: z.array(KindRule) }),
  "apps.permit": done,
  "sites.rules": z.object({ rules: z.array(SiteRule) }),
  "sites.permit": done,
  "logins.list": z.object({ sites: z.array(z.object({ site: z.string(), cookies: z.int() })) }),
  "logins.forget": done,
  "approvals.list": z.object({ approvals: z.array(z.object({ chat: Chat, approval: Approval })) }),
  "keys.list": KeysState,
  "keys.login": LoginStep,
  "keys.answer": LoginStep,
  "keys.cancel": done,
  "keys.test": KeyTest,
  "keys.logout": done,
  "models.choose": done,
  "models.think": done,
  "models.voice": done,
} satisfies Record<Method, z.ZodType>;

export type Params = { [C in Call as C["method"]]: C["params"] };
export type Results = { [M in Method]: z.infer<(typeof results)[M]> };

/**
 * Result parsers keyed by method. The mapped type keeps each method's own
 * result type, so a client generic over M gets Results[M] back without casts.
 */
export const parseResult: { [M in Method]: (raw: unknown) => Results[M] } = {
  "session.sync": (raw) => results["session.sync"].parse(raw),
  "session.history": (raw) => results["session.history"].parse(raw),
  "chat.send": (raw) => results["chat.send"].parse(raw),
  "chat.stop": (raw) => results["chat.stop"].parse(raw),
  "chat.retry": (raw) => results["chat.retry"].parse(raw),
  "chats.list": (raw) => results["chats.list"].parse(raw),
  "chats.create": (raw) => results["chats.create"].parse(raw),
  "chats.rename": (raw) => results["chats.rename"].parse(raw),
  "chats.delete": (raw) => results["chats.delete"].parse(raw),
  "approval.resolve": (raw) => results["approval.resolve"].parse(raw),
  "connection.begin": (raw) => results["connection.begin"].parse(raw),
  "connection.dismiss": (raw) => results["connection.dismiss"].parse(raw),
  "browser.control": (raw) => results["browser.control"].parse(raw),
  "browser.fit": (raw) => results["browser.fit"].parse(raw),
  "browser.open": (raw) => results["browser.open"].parse(raw),
  "task.stop": (raw) => results["task.stop"].parse(raw),
  "schedules.list": (raw) => results["schedules.list"].parse(raw),
  "schedule.control": (raw) => results["schedule.control"].parse(raw),
  "apps.search": (raw) => results["apps.search"].parse(raw),
  "apps.accounts": (raw) => results["apps.accounts"].parse(raw),
  "apps.connect": (raw) => results["apps.connect"].parse(raw),
  "apps.disconnect": (raw) => results["apps.disconnect"].parse(raw),
  "apps.permissions": (raw) => results["apps.permissions"].parse(raw),
  "apps.permit": (raw) => results["apps.permit"].parse(raw),
  "sites.rules": (raw) => results["sites.rules"].parse(raw),
  "sites.permit": (raw) => results["sites.permit"].parse(raw),
  "logins.list": (raw) => results["logins.list"].parse(raw),
  "logins.forget": (raw) => results["logins.forget"].parse(raw),
  "approvals.list": (raw) => results["approvals.list"].parse(raw),
  "keys.list": (raw) => results["keys.list"].parse(raw),
  "keys.login": (raw) => results["keys.login"].parse(raw),
  "keys.answer": (raw) => results["keys.answer"].parse(raw),
  "keys.cancel": (raw) => results["keys.cancel"].parse(raw),
  "keys.test": (raw) => results["keys.test"].parse(raw),
  "keys.logout": (raw) => results["keys.logout"].parse(raw),
  "models.choose": (raw) => results["models.choose"].parse(raw),
  "models.think": (raw) => results["models.think"].parse(raw),
  "models.voice": (raw) => results["models.voice"].parse(raw),
};

/** What a server implements: one function per method. */
export type Handlers = { [M in Method]: (params: Params[M]) => Promise<Results[M]> };

/** Route a parsed call to its handler. Generic over M, so no casts are needed. */
export function dispatch<M extends Method>(
  handlers: Handlers,
  call: { method: M; params: Params[M] },
): Promise<Results[M]> {
  return handlers[call.method](call.params);
}

/* ---------- JSON-RPC 2.0 framing ---------- */

export const RpcId = z.union([z.int(), z.string()]);

/** Framing only; `Call` parses method + params, so unknown methods and bad params get distinct errors. */
export const Request = z.object({
  jsonrpc: z.literal("2.0"),
  id: RpcId,
  method: z.string(),
  params: z.unknown(),
});

export const RpcError = z.object({ code: z.int(), message: z.string() });

export const Response = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: RpcId, result: z.unknown() }),
  z.object({ jsonrpc: z.literal("2.0"), id: RpcId.nullable(), error: RpcError }),
]);

/** The only notification, server → client: a chat's event, or the chats as they now are. */
export const Notification = z.object({ jsonrpc: z.literal("2.0"), method: z.literal("push"), params: Push });

export const errors = {
  parse: { code: -32700, message: "Parse error" },
  invalidRequest: { code: -32600, message: "Invalid request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  invalidParams: { code: -32602, message: "Invalid params" },
} as const satisfies Record<string, z.infer<typeof RpcError>>;

export type Request = z.infer<typeof Request>;
export type Response = z.infer<typeof Response>;
export type Notification = z.infer<typeof Notification>;
