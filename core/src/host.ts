/**
 * Runs the conversation: keeps the event log, decides client commands, and
 * hands effects to the ports. Ports report back by emitting protocol events.
 * The host is a Session, so a transport only frames it (api/) or a client
 * uses it in-process (web demo, tests).
 */
import {
  type Browser,
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
import { type AgentAction, type Command, type Context, type Effect, type Rejection, decide, decideAgent, recover } from "./decide.ts";

export type Emit = (event: Event) => void;

/** Ids that stay unique across restarts and processes (a journal outlives any counter). */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** What the agent can do while it runs: report events, and act through the rules. */
export interface AgentIO {
  emit: Emit;
  act(action: AgentAction): { ok: true; id: string } | { ok: false; reason: string };
}

/** What a browser run can do: report events, and tell the agent how it went. */
export interface RunIO {
  emit: Emit;
  /** Wake the agent with a note (not shown as a user message), e.g. a finished run's result. */
  report(note: string): void;
}

/** The outside world. Each port gets `emit` to report what happened. */
export interface Ports {
  /** Run the agent on a new prompt. */
  prompt(text: string, agent: AgentIO): void;
  /** Run a browser task the agent started. */
  browse(browser: Browser, run: RunIO): void;
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

/** Where the event log survives restarts. The host replays it on start and appends every event. */
export interface Journal {
  load(): Envelope[];
  append(envelope: Envelope): void;
}

/** A rejected command, carried to the transport as a JSON-RPC error. */
export class Rejected extends Error {
  readonly rejection: Rejection;
  constructor(rejection: Rejection) {
    super(rejection.kind === "notFound" ? `${rejection.entity} ${rejection.id} not found` : `cannot ${rejection.action} from ${rejection.from}`);
    this.rejection = rejection;
  }
}

export function createHost(ports: Ports, options: { seed?: Entity[]; clock?: Clock; journal?: Journal } = {}): Session {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  let state: State = empty;
  const log: Envelope[] = [];
  const listeners = new Set<(envelope: Envelope) => void>();

  const record = (envelope: Envelope) => {
    state = apply(state, envelope);
    log.push(envelope);
  };
  const emit: Emit = (event) => {
    const envelope = { seq: state.seq + 1, event };
    record(envelope);
    options.journal?.append(envelope);
    for (const listener of listeners) listener(envelope);
  };

  const context = (): Context => ({ now: clock.now(), id: newId });

  const agent: AgentIO = {
    emit,
    act(action) {
      const decision = decideAgent(state, action.kind, action, context());
      if (!decision.ok) return { ok: false, reason: new Rejected(decision.rejection).message };
      decision.events.forEach(emit);
      decision.effects.forEach(run);
      return { ok: true, id: decision.output.id };
    },
  };

  function run(effect: Effect): void {
    switch (effect.kind) {
      case "prompt":
        return ports.prompt(effect.text, agent);
      case "interrupt":
        return ports.interrupt(emit);
      case "browser":
        return ports.browser(effect, emit);
      case "approval":
        return ports.approval(effect, emit);
      case "stopTask":
        return ports.stopTask(effect.id, emit);
      case "browse":
        return ports.browse(effect.browser, { emit, report: (note) => ports.prompt(note, agent) });
    }
  }

  /** Decide, record, then act. A rejection becomes a Rejected error. */
  const command = <M extends Command["method"]>(method: M, params: Params[M]) => {
    const decision = decide(state, { method, params }, context());
    if (!decision.ok) throw new Rejected(decision.rejection);
    decision.events.forEach(emit);
    decision.effects.forEach(run);
    return decision.output;
  };

  // a journal with history wins over the seed
  const history = options.journal?.load() ?? [];
  history.forEach(record);
  recover(state).forEach(emit);
  if (history.length === 0) for (const entity of options.seed ?? []) emit({ kind: "upserted", entity });

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
