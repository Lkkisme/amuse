/**
 * Runs the conversation: keeps the event log, decides client commands, and
 * hands effects to the ports. Ports report back by emitting protocol events.
 * The host is a Session, so a transport only frames it (api/) or a client
 * uses it in-process (web demo, tests).
 */
import {
  type Connection,
  type Entity,
  type Envelope,
  type Event,
  type Handlers,
  type Params,
  type Session,
  type State,
  apply,
  dispatch,
  empty,
} from "@remuse/protocol";
import { type Command, type Context, type Effect, type Rejection, decide } from "./decide.ts";

export type Emit = (event: Event) => void;

/** The outside world. Each port gets `emit` to report what happened. */
export interface Ports {
  /** Run the agent on a new prompt. */
  prompt(text: string, emit: Emit): void;
  /** Stop the agent's current run. */
  interrupt(emit: Emit): void;
  browser(effect: Extract<Effect, { kind: "browser" }>, emit: Emit): void;
  approval(effect: Extract<Effect, { kind: "approval" }>, emit: Emit): void;
  stopTask(id: string, emit: Emit): void;
  /** Start connecting an app; resolves to the provider's hosted link. */
  connect(connection: Connection, emit: Emit): Promise<string>;
}

export interface Clock {
  now(): string;
}

/** A rejected command, carried to the transport as a JSON-RPC error. */
export class Rejected extends Error {
  readonly rejection: Rejection;
  constructor(rejection: Rejection) {
    super(rejection.kind === "notFound" ? `${rejection.entity} ${rejection.id} not found` : `cannot ${rejection.action} from ${rejection.from}`);
    this.rejection = rejection;
  }
}

export function createHost(ports: Ports, options: { seed?: Entity[]; clock?: Clock } = {}): Session {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  let state: State = empty;
  const log: Envelope[] = [];
  const listeners = new Set<(envelope: Envelope) => void>();
  let ids = 0;

  const emit: Emit = (event) => {
    const envelope = { seq: state.seq + 1, event };
    state = apply(state, envelope);
    log.push(envelope);
    for (const listener of listeners) listener(envelope);
  };

  const run = (effect: Effect) => {
    switch (effect.kind) {
      case "prompt":
        return ports.prompt(effect.text, emit);
      case "interrupt":
        return ports.interrupt(emit);
      case "browser":
        return ports.browser(effect, emit);
      case "approval":
        return ports.approval(effect, emit);
      case "stopTask":
        return ports.stopTask(effect.id, emit);
    }
  };

  /** Decide, record, then act. A rejection becomes a Rejected error. */
  const command = <M extends Command["method"]>(method: M, params: Params[M]) => {
    const context: Context = { now: clock.now(), id: (prefix) => `${prefix}${++ids}` };
    const decision = decide(state, { method, params }, context);
    if (!decision.ok) throw new Rejected(decision.rejection);
    decision.events.forEach(emit);
    decision.effects.forEach(run);
    return decision.output;
  };

  for (const entity of options.seed ?? []) emit({ kind: "upserted", entity });

  const handlers: Handlers = {
    "session.sync": async ({ since }) =>
      since !== null && since <= state.seq && (log[0]?.seq ?? 1) <= since + 1
        ? { kind: "events", events: log.filter((e) => e.seq > since) }
        : { kind: "snapshot", state },
    "chat.send": async (params) => command("chat.send", params),
    "chat.stop": async (params) => command("chat.stop", params),
    "approval.resolve": async (params) => command("approval.resolve", params),
    "connection.begin": async (params) => ({ url: await ports.connect(command("connection.begin", params), emit) }),
    "connection.dismiss": async (params) => command("connection.dismiss", params),
    "browser.control": async (params) => command("browser.control", params),
    "task.stop": async (params) => command("task.stop", params),
  };

  return {
    call: (method, params) => dispatch(handlers, { method, params }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
