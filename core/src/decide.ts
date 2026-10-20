/**
 * The domain rules, as one pure function: a client command and the current
 * state go in; the changes that record it and the effects the outside world
 * must carry out come out — or a typed rejection. No IO, no clock, no ids of
 * its own: the host passes them in.
 */
import type {
  Approval,
  Browser,
  BrowserStatus,
  Call,
  Connection,
  Entity,
  Event,
  Params,
  Resolution,
  State,
  TaskStatus,
} from "@remuse/protocol";

/** Calls that do not touch the conversation: reading it, and the app directory (Ports.apps). */
export type Query = Extract<Call, { method: "session.sync" | "session.history" | `apps.${string}` | `sites.${string}` }>;
/** Client calls that change the conversation. */
export type Command = Exclude<Call, Query>;
type CommandMethod = Command["method"];

/** An event before it is recorded: an upsert gets its place in the feed then (see `place`). */
export type Change = { kind: "upserted"; entity: Entity } | Extract<Event, { kind: "appended" | "activity" }>;

/** The change as the event that records it in `state`: an entity keeps its index, a new one goes on the end. */
export function place(state: State, change: Change): Event {
  if (change.kind !== "upserted") return change;
  const at = state.entities.findIndex((e) => e.id === change.entity.id);
  return { ...change, index: state.earlier + (at < 0 ? state.entities.length : at) };
}

/** Work for the ports once the changes are recorded. */
export type Effect =
  | { kind: "prompt"; text: string }
  | { kind: "interrupt" }
  /** `browser` is the run as it stands after the move */
  | { kind: "browser"; browser: Browser; action: BrowserAction }
  | { kind: "approval"; id: string; resolution: Resolution }
  | { kind: "stopTask"; id: string }
  | { kind: "browse"; browser: Browser }
  /** shape the run's desktop like the user's screen */
  | { kind: "fit"; id: string; viewer: { width: number; height: number } };

/** Statuses an agent may report for a browser run in flight (paused and stopped belong to the user). */
export type BrowserProgress = Extract<BrowserStatus, "working" | "waiting" | "needs_you">;
/** How a run the agent drove may end: always with a result. */
export type BrowserEnd = Extract<BrowserStatus, "completed" | "failed">;
export type TaskProgress = Extract<TaskStatus, "working" | "waiting" | "completed" | "failed">;

/**
 * What agents and ports may do to the conversation. Decided like client
 * commands, so they cannot put the state anywhere the rules forbid: every
 * status change goes through here; ports can only stream replies and set
 * the activity line directly.
 */
export type AgentAction =
  /** Ask the user to connect an app; a pending request for the same provider is reused. */
  | { kind: "connect"; provider: string; title: string }
  /** Hand a browser task to the browser port; it starts working at once. `instructions`: the user's ask in full. */
  | { kind: "browse"; title: string; url: string; instructions: string }
  /** Ask the user to approve a consequential step before taking it; `remember`: the answer may become a rule. */
  | { kind: "ask"; action: string; target: string; detail: string; remember: boolean }
  /** A browser run's progress, from the agent driving it. */
  | { kind: "browserStatus"; id: string; status: BrowserProgress }
  /** What the agent driving a run is doing right now (null: nothing in particular). */
  | { kind: "browserStep"; id: string; step: string | null }
  /** A browser run's end, from the agent driving it, with what came of it. */
  | { kind: "browserEnded"; id: string; status: BrowserEnd; result: string }
  | { kind: "taskStatus"; id: string; status: TaskProgress }
  /** The run's browser is gone (closed): its card is only a record from now on. */
  | { kind: "released"; id: string }
  /** The app's account is live: the connection is connected. */
  | { kind: "connected"; id: string };

type Actions = { [A in AgentAction as A["kind"]]: A };

/** What was attempted, from where. */
export type Rejection =
  | { kind: "notFound"; entity: Entity["kind"]; id: string }
  /** the run's browser is no longer there to take over */
  | { kind: "gone"; id: string }
  | {
      kind: "invalid";
      action: BrowserAction | "fit" | "resolve" | "always" | "begin" | "dismiss" | "stop" | AgentAction["kind"];
      from: BrowserStatus | TaskStatus | Approval["status"] | Connection["status"];
    };

/** What a command yields besides changes: the prompt chat.send created, the connection to begin. */
export type Outputs = {
  [M in CommandMethod]: M extends "chat.send" ? { id: string } : M extends "connection.begin" ? Connection : null;
};

export type Decision<T> = { ok: true; changes: Change[]; effects: Effect[]; output: T } | { ok: false; rejection: Rejection };

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

/** A run the agent may still move: in flight and not held by the user. */
const agentHeld: readonly BrowserStatus[] = ["queued", "working", "waiting", "needs_you"];
const runningTask: readonly TaskStatus[] = ["queued", "working", "waiting"];
const terminalBrowser: readonly BrowserStatus[] = ["completed", "failed", "stopped"];

export type Verdict = "approved" | "denied";
const verdicts: Record<Resolution, Verdict> = {
  allow_once: "approved",
  allow_session: "approved",
  allow_always: "approved",
  deny: "denied",
  deny_always: "denied",
};
export const verdict = (resolution: Resolution): Verdict => verdicts[resolution];
/** Whether an answer is meant for next time too. */
export const lasting = (resolution: Resolution): boolean => resolution === "allow_always" || resolution === "deny_always";

/** What an agent learns of the user's answer to its ask: approved or not, and whether to keep it as a rule. */
export type Answer = { verdict: Verdict; remember: boolean };

const ok = <T>(changes: Change[], effects: Effect[], output: T): Decision<T> => ({ ok: true, changes, effects, output });
const reject = (rejection: Rejection): Decision<never> => ({ ok: false, rejection });
const upsert = (entity: Entity): Change => ({ kind: "upserted", entity });

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
    // "always" is offered only where a rule can hold it
    if (lasting(resolution) && !approval.remember) return reject({ kind: "invalid", action: "always", from: approval.status });
    return ok([upsert({ ...approval, status: verdict(resolution) })], [{ kind: "approval", id, resolution }], null);
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
    if (action === "take" && !browser.live) return reject({ kind: "gone", id });
    // a stopped run's browser closes at once
    // the user takes it, or it stops: its agent is doing nothing now
    const moved: Browser = { ...browser, status: move.to, step: action === "handBack" ? browser.step : null, live: action === "stop" ? false : browser.live };
    return ok([upsert(moved)], [{ kind: "browser", browser: moved, action }], null);
  },

  /** Only the user's own hold reshapes the desktop; the agent keeps its standard size. */
  "browser.fit": (state, { id, width, height }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    if (browser.status !== "paused") return reject({ kind: "invalid", action: "fit", from: browser.status });
    return ok([], [{ kind: "fit", id, viewer: { width, height } }], null);
  },

  "task.stop": (state, { id }) => {
    const task = find(state, "task", id);
    if (!task) return reject({ kind: "notFound", entity: "task", id });
    if (!runningTask.includes(task.status)) return reject({ kind: "invalid", action: "stop", from: task.status });
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
  ask: (_, { action, target, detail, remember }, ctx) => {
    const id = ctx.id("a");
    return ok([upsert({ kind: "approval", id, at: ctx.now, action, target, detail, remember, status: "pending" })], [], { id });
  },
  browse: (_, { title, url, instructions }, ctx) => {
    const browser: Browser = { kind: "browser", id: ctx.id("b"), at: ctx.now, title, url, status: "working", instructions, result: null, step: null, live: true };
    return ok([upsert(browser)], [{ kind: "browse", browser }], { id: browser.id });
  },
  released: (state, { id }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    return ok(browser.live ? [upsert({ ...browser, live: false })] : [], [], { id });
  },
  browserStatus: (state, { id, status }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    if (!agentHeld.includes(browser.status)) return reject({ kind: "invalid", action: "browserStatus", from: browser.status });
    return ok(browser.status === status ? [] : [upsert({ ...browser, status })], [], { id });
  },
  browserStep: (state, { id, step }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    if (!agentHeld.includes(browser.status)) return reject({ kind: "invalid", action: "browserStep", from: browser.status });
    return ok(browser.step === step ? [] : [upsert({ ...browser, step })], [], { id });
  },
  browserEnded: (state, { id, status, result }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    // a run the user holds ends too when they hand back what was left of it (paused → completed)
    if (!agentHeld.includes(browser.status) && browser.status !== "paused") return reject({ kind: "invalid", action: "browserEnded", from: browser.status });
    return ok([upsert({ ...browser, status, result, step: null })], [], { id });
  },
  taskStatus: (state, { id, status }) => {
    const task = find(state, "task", id);
    if (!task) return reject({ kind: "notFound", entity: "task", id });
    if (!runningTask.includes(task.status)) return reject({ kind: "invalid", action: "taskStatus", from: task.status });
    return ok(task.status === status ? [] : [upsert({ ...task, status })], [], { id });
  },
  connected: (state, { id }) => {
    const connection = find(state, "connection", id);
    if (!connection) return reject({ kind: "notFound", entity: "connection", id });
    if (connection.status === "connected") return ok([], [], { id });
    return ok([upsert({ ...connection, status: "connected" })], [], { id });
  },
};

/** Apply the rule for an agent action. The kind is passed apart so TS can correlate it with the action. */
export function decideAgent<K extends keyof Actions>(state: State, kind: K, action: Actions[K], ctx: Context): Decision<{ id: string }> {
  return agentRules[kind](state, action, ctx);
}

/**
 * After a restart nothing is mid-run any more: streaming replies end where
 * they stopped, browser runs and tasks in flight are stopped (nothing drives
 * them now) and no browser is live, pending approvals time out (nobody waits on them), and the
 * activity line clears.
 */
export function recover(state: State): Change[] {
  const settle = (e: Entity): Entity | null => {
    switch (e.kind) {
      case "reply":
        return e.streaming ? { ...e, streaming: false } : null;
      case "browser": {
        // the pool lets go of every browser on start: none is live after a restart
        const status = terminalBrowser.includes(e.status) ? e.status : "stopped";
        return status === e.status && !e.live && e.step === null ? null : { ...e, status, step: null, live: false };
      }
      case "task":
        return runningTask.includes(e.status) ? { ...e, status: "stopped" } : null;
      case "approval":
        return e.status === "pending" ? { ...e, status: "timed_out" } : null;
      case "prompt":
      case "connection":
        return null;
    }
  };
  const settled = state.entities.flatMap((e) => {
    const next = settle(e);
    return next ? [upsert(next)] : [];
  });
  return state.activity === null ? settled : [...settled, { kind: "activity", activity: null }];
}
