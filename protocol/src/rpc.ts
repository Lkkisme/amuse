/**
 * Client → server: JSON-RPC 2.0 over one WebSocket. Calls are a union on
 * `method`; results are keyed by method and checked for exhaustiveness with
 * `satisfies`. The server pushes `event` notifications (see events.ts).
 * Live browser pixels are not JSON-RPC; they stream on their own channel.
 */
import { z } from "zod";
import { Id } from "./entities.ts";
import { Envelope, Seq, State } from "./events.ts";

const call = <M extends string, P extends z.ZodObject>(method: M, params: P) =>
  z.object({ method: z.literal(method), params });

export const Call = z.discriminatedUnion("method", [
  /** Catch up from `since` (null: from nothing). */
  call("session.sync", z.object({ since: Seq.nullable() })),
  call("chat.send", z.object({ text: z.string().min(1) })),
  /** Stop the agent's current reply. */
  call("chat.stop", z.object({})),
  call("approval.decide", z.object({ id: Id, decision: z.enum(["approve", "deny"]) })),
  call("task.answer", z.object({ id: Id, answers: z.array(z.object({ question: Id, answer: z.string() })) })),
  /** Start connecting: returns the provider's hosted auth link. */
  call("connection.begin", z.object({ id: Id })),
  call("connection.dismiss", z.object({ id: Id })),
  call("browser.control", z.object({ id: Id, action: z.enum(["take", "handBack", "stop"]) })),
]);

export type Call = z.infer<typeof Call>;
export type Method = Call["method"];

const done = z.null();

export const results = {
  /** Events since `since` when the server still has them, else a snapshot. */
  "session.sync": z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("events"), events: z.array(Envelope) }),
    z.object({ kind: z.literal("snapshot"), state: State }),
  ]),
  "chat.send": z.object({ id: Id }),
  "chat.stop": done,
  "approval.decide": done,
  "task.answer": done,
  "connection.begin": z.object({ url: z.url() }),
  "connection.dismiss": done,
  "browser.control": done,
} satisfies Record<Method, z.ZodType>;

export type Params = { [C in Call as C["method"]]: C["params"] };
export type Results = { [M in Method]: z.infer<(typeof results)[M]> };

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

/** The only notification: one event, server → client. */
export const Notification = z.object({ jsonrpc: z.literal("2.0"), method: z.literal("event"), params: Envelope });

export const errors = {
  parse: { code: -32700, message: "Parse error" },
  invalidRequest: { code: -32600, message: "Invalid request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  invalidParams: { code: -32602, message: "Invalid params" },
} as const satisfies Record<string, z.infer<typeof RpcError>>;

export type Request = z.infer<typeof Request>;
export type Response = z.infer<typeof Response>;
export type Notification = z.infer<typeof Notification>;
