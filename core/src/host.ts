/**
 * Runs the conversation: keeps the event log, decides client commands, and
 * hands effects to the ports. Ports say things (replies, activity) and change
 * anything else by acting through the rules, like clients do.
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
  type Reply,
  type Session,
  type State,
  type Update,
  apply,
  dispatch,
  empty,
} from "@remuse/protocol";
import {
  type AgentAction,
  type Command,
  type Context,
  type Effect,
  type Rejection,
  type Verdict,
  decide,
  decideAgent,
  recover,
  verdict,
} from "./decide.ts";

/**
 * What ports may record directly: what the agent says (its replies, streamed)
 * and what it is doing (the activity line). Everything else is an action.
 */
export type Say = { kind: "upserted"; entity: Reply } | Extract<Event, { kind: "appended" | "activity" }>;
export type Emit = (say: Say) => void;

/** Ids that stay unique across restarts and processes (a journal outlives any counter). */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export type Acted = { ok: true; id: string } | { ok: false; rejection: Rejection };

/**
 * What ports and agents can do: say things, act through the rules, wait for
 * an approval, and wake the chat agent with a note (not shown as a user
 * message), e.g. a finished run's result.
 */
export interface AgentIO {
  emit: Emit;
  act(action: AgentAction): Acted;
  /** Resolves when the user decides approval `id` (from an `ask`); at once if already decided. */
  decision(id: string): Promise<Verdict>;
  report(note: string): void;
}

/** The outside world. Every port gets the same AgentIO. */
export interface Ports {
  /** Run the agent on a new prompt. */
  prompt(text: string, io: AgentIO): void;
  /** Stop the agent's current run. */
  interrupt(io: AgentIO): void;
  /** Run a browser task the agent started. */
  browse(browser: Browser, io: AgentIO): void;
  browser(effect: Extract<Effect, { kind: "browser" }>, io: AgentIO): void;
  approval(effect: Extract<Effect, { kind: "approval" }>, io: AgentIO): void;
  stopTask(id: string, io: AgentIO): void;
  /** Start connecting an app; resolves to the provider's hosted link. */
  connect(connection: Connection, io: AgentIO): Promise<string>;
}

/** A rejection in words, for errors and for agents. */
export function describe(rejection: Rejection): string {
  return rejection.kind === "notFound" ? `${rejection.entity} ${rejection.id} not found` : `cannot ${rejection.action} from ${rejection.from}`;
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
    super(describe(rejection));
    this.rejection = rejection;
  }
}

export function createHost(
  ports: Ports,
  options: { seed?: Entity[]; clock?: Clock; journal?: Journal; ids?: (prefix: string) => string } = {},
): Session {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  let state: State = empty;
  const log: Envelope[] = [];
  const listeners = new Set<(update: Update) => void>();

  const record = (envelope: Envelope) => {
    state = apply(state, envelope);
    log.push(envelope);
  };
  /** Every event goes through here; ports only reach the Say subset of it (AgentIO.emit). */
  const commit = (event: Event) => {
    const envelope = { seq: state.seq + 1, event };
    record(envelope);
    options.journal?.append(envelope);
    for (const listener of listeners) listener({ kind: "event", envelope });
  };

  const context = (): Context => ({ now: clock.now(), id: options.ids ?? newId });

  /** Callers waiting on an approval, settled when the user resolves it. */
  const waiting = new Map<string, ((verdict: Verdict) => void)[]>();
  const settle = (id: string, outcome: Verdict) => {
    waiting.get(id)?.forEach((resolve) => resolve(outcome));
    waiting.delete(id);
  };

  const agent: AgentIO = {
    emit: commit,
    decision(id) {
      const approval = state.entities.find((e) => e.kind === "approval" && e.id === id);
      if (approval?.kind === "approval" && approval.status !== "pending") return Promise.resolve(approval.status === "approved" ? "approved" : "denied");
      return new Promise((resolve) => waiting.set(id, [...(waiting.get(id) ?? []), resolve]));
    },
    report: (note) => ports.prompt(note, agent),
    act(action) {
      const decision = decideAgent(state, action.kind, action, context());
      if (!decision.ok) return decision;
      decision.events.forEach(commit);
      decision.effects.forEach(run);
      return { ok: true, id: decision.output.id };
    },
  };

  function run(effect: Effect): void {
    switch (effect.kind) {
      case "prompt":
        return ports.prompt(effect.text, agent);
      case "interrupt":
        return ports.interrupt(agent);
      case "browser":
        return ports.browser(effect, agent);
      case "approval":
        settle(effect.id, verdict(effect.resolution));
        return ports.approval(effect, agent);
      case "stopTask":
        return ports.stopTask(effect.id, agent);
      case "browse":
        return ports.browse(effect.browser, agent);
    }
  }

  /** Decide, record, then act. A rejection becomes a Rejected error. */
  const command = <M extends Command["method"]>(method: M, params: Params[M]) => {
    const decision = decide(state, { method, params }, context());
    if (!decision.ok) throw new Rejected(decision.rejection);
    decision.events.forEach(commit);
    decision.effects.forEach(run);
    return decision.output;
  };

  // a journal with history wins over the seed
  const history = options.journal?.load() ?? [];
  history.forEach(record);
  recover(state).forEach(commit);
  if (history.length === 0) for (const entity of options.seed ?? []) commit({ kind: "upserted", entity });

  const handlers: Handlers = {
    "session.sync": async ({ since }) =>
      since !== null && since <= state.seq && (log[0]?.seq ?? 1) <= since + 1
        ? { kind: "events", events: log.filter((e) => e.seq > since) }
        : { kind: "snapshot", state },
    "chat.send": async (params) => command("chat.send", params),
    "chat.stop": async (params) => command("chat.stop", params),
    "approval.resolve": async (params) => command("approval.resolve", params),
    "connection.begin": async (params) => ({ url: await ports.connect(command("connection.begin", params), agent) }),
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
