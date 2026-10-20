/**
 * The domain rules, as one pure function: a client command and the current
 * state go in; the events that record it and the effects the outside world
 * must carry out come out — or a typed rejection. No IO, no clock, no ids of
 * its own: the host passes them in.
 */
import type { Browser, BrowserStatus, Call, Connection, Entity, Event, Params, Resolution, State } from "@remuse/protocol";

/** Client calls that change the conversation (sync only reads). */
export type Command = Exclude<Call, { method: "session.sync" }>;
type CommandMethod = Command["method"];

/** Work for the ports once the events are recorded. */
export type Effect =
  | { kind: "prompt"; text: string }
  | { kind: "interrupt" }
  /** `browser` is the run as it stands after the move */
  | { kind: "browser"; browser: Browser; action: BrowserAction }
  | { kind: "approval"; id: string; resolution: Resolution }
  | { kind: "stopTask"; id: string }
  | { kind: "browse"; browser: Browser };

/**
 * What the agent may do to the conversation, through its tools. Decided like
 * client commands, so the agent cannot put the state anywhere the rules forbid.
 */
export type AgentAction =
  /** Ask the user to connect an app; a pending request for the same provider is reused. */
  | { kind: "connect"; provider: string; title: string }
  /** Hand a browser task to the browser port; it starts working at once. */
  | { kind: "browse"; title: string; url: string };

type Actions = { [A in AgentAction as A["kind"]]: A };

export type Rejection =
  | { kind: "notFound"; entity: Entity["kind"]; id: string }
  | { kind: "invalid"; action: string; from: string };

/** What a command yields besides events: the prompt chat.send created, the connection to begin. */
export type Outputs = {
  [M in CommandMethod]: M extends "chat.send" ? { id: string } : M extends "connection.begin" ? Connection : null;
};

export type Decision<T> = { ok: true; events: Event[]; effects: Effect[]; output: T } | { ok: false; rejection: Rejection };

export interface Context {
  now: string;
  id(prefix: string): string;
}

type BrowserAction = Params["browser.control"]["action"];

/** Browser transitions (Muse): where each action may start, and where it lands. */
const browserMoves: Record<BrowserAction, { from: readonly BrowserStatus[]; to: BrowserStatus }> = {
  take: { from: ["working", "waiting", "needs_you", "completed"], to: "paused" },
  handBack: { from: ["paused"], to: "working" },
  stop: { from: ["queued", "working", "waiting", "needs_you", "paused"], to: "stopped" },
};

const runningTask = ["queued", "working", "waiting"] as const;

const ok = <T>(events: Event[], effects: Effect[], output: T): Decision<T> => ({ ok: true, events, effects, output });
const reject = (rejection: Rejection): Decision<never> => ({ ok: false, rejection });
const upsert = (entity: Entity): Event => ({ kind: "upserted", entity });

function find<K extends Entity["kind"]>(state: State, kind: K, id: string): Extract<Entity, { kind: K }> | undefined {
  return state.entities.find((e): e is Extract<Entity, { kind: K }> => e.kind === kind && e.id === id);
}

type Rules = { [M in CommandMethod]: (state: State, params: Params[M], ctx: Context) => Decision<Outputs[M]> };

const rules: Rules = {
  "chat.send": (_, { text }, ctx) => {
    const id = ctx.id("p");
    return ok([upsert({ kind: "prompt", id, at: ctx.now, text })], [{ kind: "prompt", text }], { id });
  },

  "chat.stop": (state) => {
    const cut = state.entities.flatMap((e) => (e.kind === "reply" && e.streaming ? [upsert({ ...e, streaming: false })] : []));
    return ok([...cut, { kind: "activity", activity: null }], [{ kind: "interrupt" }], null);
  },

  "approval.resolve": (state, { id, resolution }) => {
    const approval = find(state, "approval", id);
    if (!approval) return reject({ kind: "notFound", entity: "approval", id });
    if (approval.status !== "pending") return reject({ kind: "invalid", action: "resolve", from: approval.status });
    const status = resolution.startsWith("allow") ? "approved" : "denied";
    return ok([upsert({ ...approval, status })], [{ kind: "approval", id, resolution }], null);
  },

  "connection.begin": (state, { id }) => {
    const connection = find(state, "connection", id);
    if (!connection) return reject({ kind: "notFound", entity: "connection", id });
    if (connection.status === "connected") return reject({ kind: "invalid", action: "begin", from: connection.status });
    return ok([], [], connection); // the host asks the connector port for the hosted link
  },

  "connection.dismiss": (state, { id }) => {
    const connection = find(state, "connection", id);
    if (!connection) return reject({ kind: "notFound", entity: "connection", id });
    if (connection.status !== "pending") return reject({ kind: "invalid", action: "dismiss", from: connection.status });
    return ok([upsert({ ...connection, status: "dismissed" })], [], null);
  },

  "browser.control": (state, { id, action }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    const move = browserMoves[action];
    if (!move.from.includes(browser.status)) return reject({ kind: "invalid", action, from: browser.status });
    const moved: Browser = { ...browser, status: move.to };
    return ok([upsert(moved)], [{ kind: "browser", browser: moved, action }], null);
  },

  "task.stop": (state, { id }) => {
    const task = find(state, "task", id);
    if (!task) return reject({ kind: "notFound", entity: "task", id });
    if (!runningTask.some((s) => s === task.status)) return reject({ kind: "invalid", action: "stop", from: task.status });
    return ok([upsert({ ...task, status: "stopped" })], [{ kind: "stopTask", id }], null);
  },
};

/** Apply the rule for a command. Generic over the method, so no casts are needed. */
export function decide<M extends CommandMethod>(
  state: State,
  command: { method: M; params: Params[M] },
  ctx: Context,
): Decision<Outputs[M]> {
  return rules[command.method](state, command.params, ctx);
}

type AgentRules = { [K in keyof Actions]: (state: State, action: Actions[K], ctx: Context) => Decision<{ id: string }> };

const agentRules: AgentRules = {
  connect: (state, { provider, title }, ctx) => {
    const pending = state.entities.find((e) => e.kind === "connection" && e.provider === provider && e.status === "pending");
    if (pending) return ok([], [], { id: pending.id });
    const id = ctx.id("c");
    return ok([upsert({ kind: "connection", id, at: ctx.now, provider, title, status: "pending" })], [], { id });
  },
  browse: (_, { title, url }, ctx) => {
    const browser: Browser = { kind: "browser", id: ctx.id("b"), at: ctx.now, title, url, status: "working" };
    return ok([upsert(browser)], [{ kind: "browse", browser }], { id: browser.id });
  },
};

/** Apply the rule for an agent action. The kind is passed apart so TS can correlate it with the action. */
export function decideAgent<K extends keyof Actions>(state: State, kind: K, action: Actions[K], ctx: Context): Decision<{ id: string }> {
  return agentRules[kind](state, action, ctx);
}

/**
 * After a restart nothing is mid-run any more: replies that were streaming
 * end where they stopped, and the activity line clears.
 */
export function recover(state: State): Event[] {
  const cut = state.entities.flatMap((e) => (e.kind === "reply" && e.streaming ? [upsert({ ...e, streaming: false })] : []));
  return state.activity === null ? cut : [...cut, { kind: "activity", activity: null }];
}
