/**
 * Runs the conversation: keeps the event log, decides client commands, and
 * hands effects to the ports. Ports say things (replies, activity) and change
 * anything else by acting through the rules, like clients do.
 * The host is a Session, so a transport only frames it (api/) or a client
 * uses it in-process (web demo, tests).
 */
import {
  type Account,
  type Permission,
  type KindRule,
  type ToolKind,
  type Browser,
  type Connection,
  type Entity,
  type Envelope,
  type Handlers,
  type Params,
  type Reply,
  type Results,
  type Schedule,
  type Session,
  type State,
  type Update,
  apply,
  dispatch,
  empty,
  recent,
} from "@remuse/protocol";
import {
  type AgentAction,
  type Change,
  type Command,
  type Context,
  type Effect,
  type Rejection,
  type Answer,
  type QuestionOutcome,
  decide,
  decideAgent,
  place,
  recover,
  tick,
  lasting,
  verdict,
} from "./decide.ts";
import { deadline, userZone } from "./schedule.ts";
import { type Timers, realTimers } from "./timers.ts";
import type { Rules } from "./policy.ts";
import { agentContext, recall } from "./context.ts";

/**
 * What ports may record directly: what the agent says (its replies, streamed)
 * and what it is doing (the activity line). Everything else is an action.
 */
export type Say = { kind: "upserted"; entity: Reply } | Extract<Change, { kind: "appended" | "activity" }>;
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
  /** The conversation so far, as the agent should know it (context.ts): newest in full, older in brief. */
  context(): string;
  /** Search the whole conversation, however old. */
  recall(query: string): string;
  /** Resolves when the user decides approval `id` (from an `ask`), or it times out; at once if already settled. */
  decision(id: string): Promise<Answer>;
  /** Wake the chat agent with a note from background work. */
  report(note: string): void;
  /** Now, and the user's time zone (their device's when they last wrote). */
  time(): { now: string; timezone: string };
  /** Resolves when Muse answers question `id` (from a `question` action), it times out, or its run ends. */
  answer(id: string): Promise<QuestionOutcome>;
  /** What Muse tells run `run` while it is in flight (instructions; a stop for a schedule's run). Returns unsubscribe. */
  listen(run: string, listener: (message: RunMessage) => void): () => void;
}

/** What a run in flight hears from Muse. */
export type RunMessage = { kind: "instruction"; text: string } | { kind: "stop" };

/** The outside world. Every port gets the same AgentIO. */
export interface Ports {
  /** Run the agent: on what the user just said (already in the conversation), or on a note from background work. */
  prompt(turn: Turn, io: AgentIO): void;
  /** Stop the agent's current run. */
  interrupt(io: AgentIO): void;
  /** Run a browser task the agent started. */
  browse(browser: Browser, io: AgentIO): void;
  /**
   * Run a schedule whose time has come, in the background, apart from the
   * chat. It reports to the chat only what is worth telling (io.report), and
   * ends with a `scheduleRan` action saying how it went.
   */
  schedule(schedule: Schedule, io: AgentIO): void;
  browser(effect: Extract<Effect, { kind: "browser" }>, io: AgentIO): void;
  approval(effect: Extract<Effect, { kind: "approval" }>, io: AgentIO): void;
  stopTask(id: string, io: AgentIO): void;
  /** Shape a held run's desktop like the user's screen. */
  fit(effect: Extract<Effect, { kind: "fit" }>, io: AgentIO): void;
  /** Start connecting an app; resolves to the provider's hosted link. */
  connect(connection: Connection, io: AgentIO): Promise<string>;
  /** The apps there are to connect, and the accounts connected (outside the conversation). */
  apps: AppDirectory;
  /** What the agents may do, per app and per site: the user's (policy.ts). */
  rules: Rules;
}

/** What wakes the agent: the user's message, or a note from its background work (not shown as a message). */
export type Turn = { kind: "message"; text: string } | { kind: "note"; text: string };

/** Where apps are found, connected and let go of: the connector's directory. */
export interface AppDirectory {
  search(query: string, cursor: string | null): Promise<Results["apps.search"]>;
  accounts(): Promise<Account[]>;
  /** The provider's hosted auth link for `app`. */
  connect(app: string): Promise<string>;
  disconnect(account: string): Promise<void>;
  /** What the agent may do with the app, by kind of tool. */
  permissions(app: string): Promise<KindRule[]>;
  permit(app: string, kind: ToolKind, permission: Permission | null): Promise<void>;
}

/** A rejection in words, for errors and for agents. */
export function describe(rejection: Rejection): string {
  switch (rejection.kind) {
    case "notFound":
      return `${rejection.entity} ${rejection.id} not found`;
    case "gone":
      return `the browser of ${rejection.id} is gone`;
    case "unsound":
      return rejection.reason;
    case "notRunning":
      return `no run ${rejection.id} is in flight (it ended, or never was)`;
    case "invalid":
      return `cannot ${rejection.action} from ${rejection.from}`;
  }
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

export interface HostOptions {
  seed?: Entity[];
  clock?: Clock;
  journal?: Journal;
  ids?: (prefix: string) => string;
  /** Entities a snapshot holds (more while older ones are still in play); older ones come by session.history. */
  snapshot?: number;
  /** What wakes the host when a schedule or an approval falls due (real timers by default). */
  timers?: Timers<unknown>;
}

/** setTimeout's longest wait (about 24.8 days); a later deadline is woken for and looked at again. */
const LONGEST_WAIT = 2 ** 31 - 1;

export function createHost(ports: Ports, options: HostOptions = {}): Session {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const snapshot = options.snapshot ?? 50;
  /** the whole feed: the host never drops what clients may ask for */
  let state: State = empty;
  const log: Envelope[] = [];
  const listeners = new Set<(update: Update) => void>();

  const record = (envelope: Envelope) => {
    state = apply(state, envelope);
    log.push(envelope);
  };
  /** Every change is recorded here; ports only reach the Say subset of them (AgentIO.emit). */
  const commit = (change: Change) => {
    const envelope = { seq: state.seq + 1, event: place(state, change) };
    record(envelope);
    options.journal?.append(envelope);
    for (const listener of listeners) listener({ kind: "event", envelope });
    if (change.kind === "upserted") arm(); // only an entity can move a deadline
  };

  /** One timer, for the earliest deadline; when it fires, whatever is due happens (decide.ts `tick`). */
  const timers = options.timers ?? realTimers;
  let armed: { at: string; handle: unknown } | null = null;
  function arm(): void {
    const at = deadline(state);
    if (armed?.at === at) return;
    if (armed) timers.clear(armed.handle);
    armed = null;
    if (at === null) return;
    const wait = Math.min(Math.max(0, Date.parse(at) - Date.parse(clock.now())), LONGEST_WAIT);
    armed = { at, handle: timers.set(wait, fire) };
  }
  function fire(): void {
    armed = null;
    const due = tick(state, clock.now());
    due.changes.forEach(commit);
    due.effects.forEach(run);
    arm();
  }

  const context = (): Context => ({ now: clock.now(), id: options.ids ?? newId });

  /** Callers waiting on an approval, settled when the user resolves it. */
  const waiting = new Map<string, ((answer: Answer) => void)[]>();
  const settle = (id: string, outcome: Answer) => {
    waiting.get(id)?.forEach((resolve) => resolve(outcome));
    waiting.delete(id);
  };
  /** Runs waiting on their questions, and runs listening for Muse. */
  const asking = new Map<string, ((outcome: QuestionOutcome) => void)[]>();
  const listening = new Map<string, Set<(message: RunMessage) => void>>();
  const tell = (run: string, message: RunMessage) => listening.get(run)?.forEach((listener) => listener(message));

  const agent: AgentIO = {
    emit: commit,
    decision(id) {
      const approval = state.entities.find((e) => e.kind === "approval" && e.id === id);
      if (approval?.kind === "approval" && approval.status !== "pending") return Promise.resolve({ verdict: approval.status, remember: false });
      return new Promise((resolve) => waiting.set(id, [...(waiting.get(id) ?? []), resolve]));
    },
    report: (note) => ports.prompt({ kind: "note", text: note }, agent),
    context: () => agentContext(state),
    recall: (query) => recall(state, query),
    time: () => ({ now: clock.now(), timezone: userZone(state) }),
    answer(id) {
      const question = state.entities.find((e) => e.kind === "question" && e.id === id);
      if (question?.kind === "question" && question.status !== "open")
        return Promise.resolve(question.status === "answered" ? { kind: "answered", text: question.answer ?? "" } : { kind: question.status });
      return new Promise((resolve) => asking.set(id, [...(asking.get(id) ?? []), resolve]));
    },
    listen(run, listener) {
      const set = listening.get(run) ?? new Set();
      set.add(listener);
      listening.set(run, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listening.delete(run);
      };
    },
    act(action) {
      const decision = decideAgent(state, action.kind, action, context());
      if (!decision.ok) return decision;
      decision.changes.forEach(commit);
      decision.effects.forEach(run);
      return { ok: true, id: decision.output.id };
    },
  };

  function run(effect: Effect): void {
    switch (effect.kind) {
      case "prompt":
        return ports.prompt({ kind: "message", text: effect.text }, agent);
      case "interrupt":
        return ports.interrupt(agent);
      case "browser":
        return ports.browser(effect, agent);
      case "approval":
        settle(effect.id, { verdict: verdict(effect.resolution), remember: lasting(effect.resolution) });
        return ports.approval(effect, agent);
      case "stopTask":
        return ports.stopTask(effect.id, agent);
      case "browse":
        return ports.browse(effect.browser, agent);
      case "fit":
        return ports.fit(effect, agent);
      case "run":
        return ports.schedule(effect.schedule, agent);
      case "expired":
        return settle(effect.id, { verdict: "timed_out", remember: false });
      case "instruct":
        return tell(effect.run, { kind: "instruction", text: effect.text });
      case "halt":
        return tell(effect.run, { kind: "stop" });
      case "settled":
        asking.get(effect.id)?.forEach((resolve) => resolve(effect.answer));
        asking.delete(effect.id);
        return;
    }
  }

  /** Decide, record, then act. A rejection becomes a Rejected error. */
  const command = <M extends Command["method"]>(method: M, params: Params[M]) => {
    const decision = decide(state, { method, params }, context());
    if (!decision.ok) throw new Rejected(decision.rejection);
    decision.changes.forEach(commit);
    decision.effects.forEach(run);
    return decision.output;
  };

  // a journal with history wins over the seed
  const history = options.journal?.load() ?? [];
  history.forEach(record);
  recover(state, clock.now()).forEach(commit);
  if (history.length === 0) for (const entity of options.seed ?? []) commit({ kind: "upserted", entity });
  arm(); // what fell due while remuse was down happens now (or is recorded as missed)

  const handlers: Handlers = {
    "session.sync": async ({ since }) =>
      since !== null && since <= state.seq && (log[0]?.seq ?? 1) <= since + 1
        ? { kind: "events", events: log.filter((e) => e.seq > since) }
        : { kind: "snapshot", state: recent(state, snapshot) },
    "session.history": async ({ before, limit }) => {
      const end = Math.min(before, state.entities.length);
      const start = Math.max(0, end - limit);
      return { seq: state.seq, earlier: start, entities: state.entities.slice(start, end) };
    },
    "chat.send": async (params) => command("chat.send", params),
    "chat.stop": async (params) => command("chat.stop", params),
    "approval.resolve": async (params) => command("approval.resolve", params),
    "connection.begin": async (params) => ({ url: await ports.connect(command("connection.begin", params), agent) }),
    "connection.dismiss": async (params) => command("connection.dismiss", params),
    "browser.control": async (params) => command("browser.control", params),
    "browser.fit": async (params) => command("browser.fit", params),
    "task.stop": async (params) => command("task.stop", params),
    "schedules.list": async () => ({ schedules: state.entities.filter((e): e is Schedule => e.kind === "schedule").reverse() }),
    "schedule.control": async (params) => command("schedule.control", params),
    "apps.search": ({ query, cursor }) => ports.apps.search(query, cursor),
    "apps.accounts": async () => ({ accounts: await ports.apps.accounts() }),
    "apps.connect": async ({ app }) => ({ url: await ports.apps.connect(app) }),
    "apps.disconnect": async ({ account }) => {
      await ports.apps.disconnect(account);
      return null;
    },
    "apps.permissions": async ({ app }) => ({ rules: await ports.apps.permissions(app) }),
    "sites.rules": async () => ({
      rules: Object.entries(await ports.rules.sites())
        .map(([site, permission]) => ({ site, permission }))
        .sort((a, b) => a.site.localeCompare(b.site)),
    }),
    "sites.permit": async ({ site, permission }) => {
      await ports.rules.setSite(site, permission);
      return null;
    },
    "apps.permit": async ({ app, kind, permission }) => {
      await ports.apps.permit(app, kind, permission);
      return null;
    },
  };

  return {
    call: (method, params) => dispatch(handlers, { method, params }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
