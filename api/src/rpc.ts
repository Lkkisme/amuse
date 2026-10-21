/**
 * JSON-RPC 2.0 framing for one client of a Session: text frames in, text
 * frames out. Parsing happens here, at the boundary, so the session only
 * ever sees typed calls. Errors map to JSON-RPC codes; a core Rejection is
 * -32000 with the reason as the message.
 */
import {
  Call,
  type Notification,
  Request,
  type Response,
  type Session,
  errors,
} from "@remuse/protocol";
import { Rejected } from "@remuse/core";

const methods = new Set<string>(
  Call.options.map((option) => option.shape.method.value),
);
const rejected = -32000;
const internal = -32603;

export interface Peer {
  /** Handle one incoming text frame. */
  receive(frame: string): Promise<void>;
  /** Stop pushing events to this client. */
  close(): void;
}

export function serve(session: Session, send: (frame: string) => void): Peer {
  const out = (frame: Response | Notification) => send(JSON.stringify(frame));
  const fail = (
    id: Request["id"] | null,
    error: { code: number; message: string },
  ) => out({ jsonrpc: "2.0", id, error });

  // a host sends events and the chats; a reset is something clients do to themselves
  const unsubscribe = session.subscribe((update) => {
    if (update.kind === "event")
      out({
        jsonrpc: "2.0",
        method: "push",
        params: { kind: "event", chat: update.chat, envelope: update.envelope },
      });
    if (update.kind === "chats")
      out({
        jsonrpc: "2.0",
        method: "push",
        params: { kind: "chats", chats: update.chats },
      });
  });

  return {
    async receive(text) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return fail(null, errors.parse);
      }
      const frame = Request.safeParse(raw);
      if (!frame.success) return fail(null, errors.invalidRequest);
      const { id, method, params } = frame.data;
      if (!methods.has(method)) return fail(id, errors.methodNotFound);
      const call = Call.safeParse({ method, params });
      if (!call.success)
        return fail(id, {
          code: errors.invalidParams.code,
          message:
            call.error.issues[0]?.message ?? errors.invalidParams.message,
        });
      try {
        out({
          jsonrpc: "2.0",
          id,
          result: await session.call(call.data.method, call.data.params),
        });
      } catch (error) {
        fail(
          id,
          error instanceof Rejected
            ? { code: rejected, message: error.message }
            : { code: internal, message: "Internal error" },
        );
      }
    },
    close: unsubscribe,
  };
}
