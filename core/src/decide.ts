/**
 * The domain rules, as one pure function: a client command and the current
 * state go in; the changes that record it and the effects the outside world
 * must carry out come out — or a typed rejection. No IO, no clock, no ids of
 * its own: the host passes them in.
 */
import type {
  Approval,
  Attachment,
  Browser,
  BrowserStatus,
  Call,
  Connection,
  Entity,
  Event,
  Failure,
  Params,
  Question,
  Resolution,
  RunOutcome,
  Schedule,
  State,
  Task,
  TaskStatus,
  When,
} from "@remuse/protocol";
import { APPROVAL_TTL_MS, GRACE_MS, MAX_SCHEDULES, check, later, nextRun, standing } from "./schedule.ts";

/** Calls that do not touch the conversation: reading it, the app directory (Ports.apps) and the keys (Ports.keys). */
export type Query = Extract<Call, { method: "session.sync" | "session.history" | "schedules.list" | `chats.${string}` | `apps.${string}` | `sites.${string}` | `keys.${string}` | `models.${string}` }>;
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
  | { kind: "prompt"; text: string; attachments: Attachment[] }
  /** wake the chat's agent again with a note it could not answer before */
  | { kind: "note"; text: string }
  | { kind: "interrupt" }
  /** `browser` is the run as it stands after the move */
  | { kind: "browser"; browser: Browser; action: BrowserAction }
  | { kind: "approval"; id: string; resolution: Resolution }
  | { kind: "stopTask"; id: string }
  /** a task the agent handed off: run it in the background */
  | { kind: "task"; task: Task }
  | { kind: "browse"; browser: Browser }
  /** shape a browser's desktop like the user's view of it; null: back to the standard size */
  | { kind: "fit"; id: string; viewer: { width: number; height: number } | null }
  /** a job for a browser that is open: its agent takes it on */
  | { kind: "job"; browser: Browser }
  /** a schedule's time has come: run it in the background */
  | { kind: "run"; schedule: Schedule }
  /** an approval went unanswered: whoever waits on it hears no */
  | { kind: "expired"; id: string }
  /** Muse told a run something more: the run reads it before its next step */
  | { kind: "instruct"; run: string; text: string }
  /** Muse stopped a schedule's run (a browser run stops through the "browser" effect) */
  | { kind: "halt"; run: string }
  /** a run's question was answered, or will not be: whoever waits on it hears which */
  | { kind: "settled"; id: string; answer: QuestionOutcome };

/** Statuses an agent may report for a browser run in flight (paused and stopped belong to the user). */
export type BrowserProgress = Extract<BrowserStatus, "working" | "waiting" | "needs_you">;
/** How a run the agent drove may end: always with a result. */
export type BrowserEnd = Extract<BrowserStatus, "completed" | "failed">;
export type TaskProgress = Extract<TaskStatus, "working" | "waiting">;
/** How a task ends, from the helper running it: always with a result. */
export type TaskEnd = Extract<TaskStatus, "completed" | "failed">;

/**
 * What agents and ports may do to the conversation. Decided like client
 * commands, so they cannot put the state anywhere the rules forbid: every
 * status change goes through here; ports can only stream replies and set
 * the activity line directly.
 */
export type AgentAction =
  /** Ask the user to connect an app; a pending request for the same provider is reused. */
  | { kind: "connect"; provider: string; title: string }
  /** Hand a browser task to the browser port; it starts working at once. `instructions`: the user's ask in full; `files`: workspace files it may upload. */
  | { kind: "browse"; title: string; url: string; instructions: string; files: string[] }
  /** Ask the user to approve a consequential step before taking it; `remember`: the answer may become a rule. */
  | { kind: "ask"; action: string; target: string; detail: string; remember: boolean }
  /** A browser run's progress, from the agent driving it. */
  | { kind: "browserStatus"; id: string; status: BrowserProgress }
  /** What the agent driving a run is doing right now (null: nothing in particular). */
  | { kind: "browserStep"; id: string; step: string | null }
  /** A browser run's end, from the agent driving it, with what came of it. */
  | { kind: "browserEnded"; id: string; status: BrowserEnd; result: string }
  /** Give a browser that is open and idle its next job (its agent remembers what happened in it). */
  | { kind: "browserJob"; id: string; title: string; instructions: string; files: string[] }
  | { kind: "taskStatus"; id: string; status: TaskProgress }
  /** Hand long or parallel work to a background helper; it starts at once. `instructions`: everything it must know. */
  | { kind: "task"; title: string; instructions: string }
  /** The helper's plan for its task, as it now stands. */
  | { kind: "taskSteps"; id: string; steps: { label: string; done: boolean }[] }
  /** A task's end, from its helper, with what came of it. */
  | { kind: "taskEnded"; id: string; status: TaskEnd; result: string }
  /** The run's browser is gone (closed): its card is only a record from now on. */
  | { kind: "released"; id: string }
  /** The app's account is live: the connection is connected. */
  | { kind: "connected"; id: string }
  /** Set up work to run later or regularly. */
  | { kind: "schedule"; title: string; instructions: string; when: When }
  /** Cancel a schedule for good. */
  | { kind: "unschedule"; id: string }
  /** A schedule's run has ended, and how. */
  | { kind: "scheduleRan"; id: string; outcome: Exclude<RunOutcome, "missed">; summary: string }
  /** Muse tells a run in flight something more: a further instruction, a correction. */
  | { kind: "instruct"; run: string; text: string }
  /** Muse stops a run in flight (not one the user holds: that is theirs). */
  | { kind: "stopRun"; run: string }
  /** A run in flight asks what only the user can answer; Muse relays it. */
  | { kind: "question"; run: string; text: string }
  /** Muse answers a run's question, as the user said. */
  | { kind: "answer"; id: string; text: string };

type Actions = { [A in AgentAction as A["kind"]]: A };

/** What was attempted, from where. */
export type Rejection =
  | { kind: "notFound"; entity: Entity["kind"]; id: string }
  /** the run's browser is no longer there to take over */
  | { kind: "gone"; id: string }
  /** no run in flight has this id (it ended, or never was) */
  | { kind: "notRunning"; id: string }
  /** there is no chat with this id */
  | { kind: "noChat"; id: string }
  /** a file sent that was not uploaded here (or not as it says) */
  | { kind: "noFile"; id: string }
  /** the main chat is always there, under its own name */
  | { kind: "mainChat" }
  /** a schedule the agent asked for cannot be: why, in words */
  | { kind: "unsound"; reason: string }
  | {
      kind: "invalid";
      action: BrowserAction | ScheduleAction | "fit" | "resolve" | "always" | "begin" | "dismiss" | "stop" | "retry" | AgentAction["kind"];
      from: BrowserStatus | TaskStatus | Approval["status"] | Connection["status"] | Schedule["status"] | Question["status"] | Failure["status"];
    };

/** What a command yields besides changes: the prompt chat.send created, the connection to begin. */
export type Outputs = {
  [M in CommandMethod]: M extends "chat.send" | "browser.open" ? { id: string } : M extends "connection.begin" ? Connection : null;
};

export type Decision<T> = { ok: true; changes: Change[]; effects: Effect[]; output: T } | { ok: false; rejection: Rejection };

export interface Context {
  now: string;
  id(prefix: string): string;
}

type BrowserAction = Params["browser.control"]["action"];
type ScheduleAction = Params["schedule.control"]["action"];

/** A job is on: the browser was given one, and it has not ended. */
const onJob = (b: Browser) => b.instructions !== "" && b.result === null;

/** Browser transitions (Muse): where each action may start, and where it lands (handing back: to the job, or idle). */
const browserMoves: Record<BrowserAction, { from: readonly BrowserStatus[]; to: (b: Browser) => BrowserStatus }> = {
  take: { from: ["working", "waiting", "needs_you", "idle", "completed"], to: () => "paused" },
  handBack: { from: ["paused"], to: (b) => (onJob(b) ? "working" : "idle") },
  stop: { from: ["queued", "working", "waiting", "needs_you", "paused", "idle"], to: () => "stopped" },
};

/** A run the agent may still move: in flight and not held by the user. */
const agentHeld: readonly BrowserStatus[] = ["queued", "working", "waiting", "needs_you"];
const runningTask: readonly TaskStatus[] = ["queued", "working", "waiting"];
const terminalBrowser: readonly BrowserStatus[] = ["completed", "failed", "stopped"];

/** What a run waiting on its question hears. */
export type QuestionOutcome = { kind: "answered"; text: string } | { kind: "timed_out" } | { kind: "closed" };

export type Verdict = "approved" | "denied";
/** How an approval ended for whoever waits on it: the user's verdict, or no answer in time. */
export type Outcome = Verdict | "timed_out";
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
export type Answer = { verdict: Outcome; remember: boolean };

const ok = <T>(changes: Change[], effects: Effect[], output: T): Decision<T> => ({ ok: true, changes, effects, output });
const reject = (rejection: Rejection): Decision<never> => ({ ok: false, rejection });
const upsert = (entity: Entity): Change => ({ kind: "upserted", entity });

function find<K extends Entity["kind"]>(state: State, kind: K, id: string): Extract<Entity, { kind: K }> | undefined {
  return state.entities.find((e): e is Extract<Entity, { kind: K }> => e.kind === kind && e.id === id);
}

/** A run in flight, by id: a browser run or a task not ended, or a schedule's run under way. */
type Flight = { kind: "browser"; browser: Browser } | { kind: "task"; task: Task } | { kind: "schedule"; schedule: Schedule };
function flight(state: State, run: string): Flight | undefined {
  const browser = find(state, "browser", run);
  if (browser?.live && (agentHeld.includes(browser.status) || browser.status === "paused" || browser.status === "idle")) return { kind: "browser", browser };
  const task = find(state, "task", run);
  if (task && runningTask.includes(task.status)) return { kind: "task", task };
  const schedule = find(state, "schedule", run);
  if (schedule?.running) return { kind: "schedule", schedule };
  return undefined;
}
const titleOf = (f: Flight) => (f.kind === "browser" ? f.browser.title : f.kind === "task" ? f.task.title : f.schedule.title);

/** A run has ended: its open questions will not be answered now. */
function closeQuestions(state: State, run: string): { changes: Change[]; effects: Effect[] } {
  const open = state.entities.filter((e): e is Question => e.kind === "question" && e.run === run && e.status === "open");
  return {
    changes: open.map((q) => upsert({ ...q, status: "closed" })),
    effects: open.map((q) => ({ kind: "settled", id: q.id, answer: { kind: "closed" } })),
  };
}

type Rules = { [M in CommandMethod]: (state: State, params: Params[M], ctx: Context) => Decision<Outputs[M]> };

const rules: Rules = {
  "chat.send": (_, { text, timezone, attachments }, ctx) => {
    const id = ctx.id("p");
    return ok([upsert({ kind: "prompt", id, at: ctx.now, text, timezone, attachments })], [{ kind: "prompt", text, attachments }], { id });
  },

  "chat.retry": (state, { id }) => {
    const failure = find(state, "failure", id);
    if (!failure) return reject({ kind: "notFound", entity: "failure", id });
    if (failure.status !== "open") return reject({ kind: "invalid", action: "retry", from: failure.status });
    const tried = upsert({ ...failure, status: "retried" });
    if (failure.turn.kind === "note") return ok([tried], [{ kind: "note", text: failure.turn.text }], null);
    // the user's latest message, as they sent it
    const last = state.entities.findLast((e): e is Extract<Entity, { kind: "prompt" }> => e.kind === "prompt");
    if (!last) return reject({ kind: "notFound", entity: "prompt", id });
    return ok([tried], [{ kind: "prompt", text: last.text, attachments: last.attachments }], null);
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
    const moved: Browser = { ...browser, status: move.to(browser), step: action === "handBack" ? browser.step : null, live: action === "stop" ? false : browser.live };
    const closed = action === "stop" ? closeQuestions(state, id) : { changes: [], effects: [] };
    return ok([upsert(moved), ...closed.changes], [{ kind: "browser", browser: moved, action }, ...closed.effects], null);
  },

  /** A browser being viewed takes the shape of the view (the agent works at it too); null when it is not. */
  "browser.fit": (state, { id, view }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    if (!browser.live) return reject({ kind: "gone", id });
    return ok([], [{ kind: "fit", id, viewer: view }], null);
  },

  /** The user's own browser: held by them from the start, its agent idle until it is given a job. */
  "browser.open": (_, { url }, ctx) => {
    const browser: Browser = { kind: "browser", id: ctx.id("b"), at: ctx.now, title: "Your browser", url, status: "paused", instructions: "", result: null, outcome: null, step: null, live: true, files: [] };
    return ok([upsert(browser)], [{ kind: "browse", browser }], { id: browser.id });
  },

  "schedule.control": (state, { id, action }, ctx) => {
    const schedule = find(state, "schedule", id);
    if (!schedule) return reject({ kind: "notFound", entity: "schedule", id });
    const from = schedule.status;
    const invalid = reject({ kind: "invalid", action, from });
    switch (action) {
      case "pause":
        return from === "active" ? ok([upsert({ ...schedule, status: "paused", next: null })], [], null) : invalid;
      case "resume": {
        // from now on: what fell in the pause is not caught up
        if (from !== "paused") return invalid;
        const next = nextRun(schedule.when, ctx.now);
        return ok([upsert({ ...schedule, status: next ? "active" : "done", next })], [], null);
      }
      case "cancel":
        return from === "active" || from === "paused" ? ok([upsert({ ...schedule, status: "cancelled", next: null })], [], null) : invalid;
    }
  },

  "task.stop": (state, { id }) => {
    const task = find(state, "task", id);
    if (!task) return reject({ kind: "notFound", entity: "task", id });
    if (!runningTask.includes(task.status)) return reject({ kind: "invalid", action: "stop", from: task.status });
    const closed = closeQuestions(state, id);
    return ok([upsert({ ...task, status: "stopped" }), ...closed.changes], [{ kind: "stopTask", id }, ...closed.effects], null);
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
    const expires = later(ctx.now, APPROVAL_TTL_MS);
    return ok([upsert({ kind: "approval", id, at: ctx.now, action, target, detail, remember, status: "pending", expires })], [], { id });
  },
  schedule: (state, { title, instructions, when }, ctx) => {
    if (standing(state).length >= MAX_SCHEDULES) return reject({ kind: "unsound", reason: `there are already ${MAX_SCHEDULES} schedules; cancel one first` });
    const sound = check(when, ctx.now);
    if (!sound.ok) return reject({ kind: "unsound", reason: sound.reason });
    const id = ctx.id("s");
    return ok([upsert({ kind: "schedule", id, at: ctx.now, title, instructions, when, status: "active", next: sound.next, running: false, last: null })], [], { id });
  },
  unschedule: (state, { id }) => {
    const schedule = find(state, "schedule", id);
    if (!schedule) return reject({ kind: "notFound", entity: "schedule", id });
    if (schedule.status !== "active" && schedule.status !== "paused") return reject({ kind: "invalid", action: "unschedule", from: schedule.status });
    return ok([upsert({ ...schedule, status: "cancelled", next: null })], [], { id });
  },
  scheduleRan: (state, { id, outcome, summary }, ctx) => {
    const schedule = find(state, "schedule", id);
    if (!schedule) return reject({ kind: "notFound", entity: "schedule", id });
    if (!schedule.running) return reject({ kind: "invalid", action: "scheduleRan", from: schedule.status });
    const closed = closeQuestions(state, id);
    return ok([upsert({ ...schedule, running: false, last: { at: ctx.now, outcome, summary } }), ...closed.changes], closed.effects, { id });
  },
  instruct: (state, { run, text }, ctx) => {
    const target = flight(state, run);
    if (!target) return reject({ kind: "notRunning", id: run });
    // an idle browser takes a job, not a word in passing
    if (target.kind === "browser" && target.browser.status === "idle") return reject({ kind: "invalid", action: "instruct", from: "idle" });
    const id = ctx.id("i");
    return ok([upsert({ kind: "instruction", id, at: ctx.now, run, title: titleOf(target), text })], [{ kind: "instruct", run, text }], { id });
  },
  stopRun: (state, { run }) => {
    const target = flight(state, run);
    if (!target) return reject({ kind: "notRunning", id: run });
    const closed = closeQuestions(state, run);
    if (target.kind === "schedule") return ok(closed.changes, [{ kind: "halt", run }, ...closed.effects], { id: run });
    if (target.kind === "task") return ok([upsert({ ...target.task, status: "stopped" }), ...closed.changes], [{ kind: "stopTask", id: run }, ...closed.effects], { id: run });
    // the user holds it: theirs to stop or hand back
    if (target.browser.status === "paused") return reject({ kind: "invalid", action: "stopRun", from: "paused" });
    const stopped: Browser = { ...target.browser, status: "stopped", step: null, live: false };
    return ok([upsert(stopped), ...closed.changes], [{ kind: "browser", browser: stopped, action: "stop" }, ...closed.effects], { id: run });
  },
  question: (state, { run, text }, ctx) => {
    const target = flight(state, run);
    if (!target) return reject({ kind: "notRunning", id: run });
    if (target.kind === "browser" && target.browser.status === "idle") return reject({ kind: "invalid", action: "question", from: "idle" });
    const id = ctx.id("q");
    const asked: Question = { kind: "question", id, at: ctx.now, run, title: titleOf(target), text, status: "open", answer: null, expires: later(ctx.now, APPROVAL_TTL_MS) };
    // a run asking is waiting for the user (Muse's "Waiting for you")
    const waiting =
      target.kind === "browser" && target.browser.status === "working"
        ? [upsert({ ...target.browser, status: "waiting" })]
        : target.kind === "task" && target.task.status === "working"
          ? [upsert({ ...target.task, status: "waiting" })]
          : [];
    return ok([upsert(asked), ...waiting], [], { id });
  },
  answer: (state, { id, text }) => {
    const question = find(state, "question", id);
    if (!question) return reject({ kind: "notFound", entity: "question", id });
    if (question.status !== "open") return reject({ kind: "invalid", action: "answer", from: question.status });
    return ok([upsert({ ...question, status: "answered", answer: text })], [{ kind: "settled", id, answer: { kind: "answered", text } }], { id });
  },
  browse: (_, { title, url, instructions, files }, ctx) => {
    const browser: Browser = { kind: "browser", id: ctx.id("b"), at: ctx.now, title, url, status: "working", instructions, result: null, step: null, live: true, outcome: null, files };
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
    // a job the user holds ends too when they hand back what was left of it; the browser stays open, idle
    if (!agentHeld.includes(browser.status) && browser.status !== "paused") return reject({ kind: "invalid", action: "browserEnded", from: browser.status });
    const closed = closeQuestions(state, id);
    const idle: Browser = { ...browser, status: browser.status === "paused" ? "paused" : "idle", result, outcome: status, step: null };
    return ok([upsert(idle), ...closed.changes], closed.effects, { id });
  },
  browserJob: (state, { id, title, instructions, files }) => {
    const browser = find(state, "browser", id);
    if (!browser) return reject({ kind: "notFound", entity: "browser", id });
    if (!browser.live) return reject({ kind: "gone", id });
    if (browser.status !== "idle") return reject({ kind: "invalid", action: "browserJob", from: browser.status });
    const working: Browser = { ...browser, title, instructions, files, status: "working", result: null, outcome: null, step: null };
    return ok([upsert(working)], [{ kind: "job", browser: working }], { id });
  },
  task: (_, { title, instructions }, ctx) => {
    const task: Task = { kind: "task", id: ctx.id("t"), at: ctx.now, title, steps: [], status: "working", instructions, result: null };
    return ok([upsert(task)], [{ kind: "task", task }], { id: task.id });
  },
  taskSteps: (state, { id, steps }) => {
    const task = find(state, "task", id);
    if (!task) return reject({ kind: "notFound", entity: "task", id });
    if (!runningTask.includes(task.status)) return reject({ kind: "invalid", action: "taskSteps", from: task.status });
    return ok([upsert({ ...task, steps })], [], { id });
  },
  taskEnded: (state, { id, status, result }) => {
    const task = find(state, "task", id);
    if (!task) return reject({ kind: "notFound", entity: "task", id });
    if (!runningTask.includes(task.status)) return reject({ kind: "invalid", action: "taskEnded", from: task.status });
    const closed = closeQuestions(state, id);
    return ok([upsert({ ...task, status, result }), ...closed.changes], closed.effects, { id });
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
 * What is due at `now`: schedules whose time has come run (or, too late to
 * start, are recorded as missed) and move on to their next time; approvals
 * nobody answered time out. A schedule still running is left until it ends.
 */
export function tick(state: State, now: string): { changes: Change[]; effects: Effect[] } {
  const changes: Change[] = [];
  const effects: Effect[] = [];
  const due = (instant: string | null): instant is string => instant !== null && Date.parse(instant) <= Date.parse(now);
  for (const e of state.entities) {
    if (e.kind === "approval" && e.status === "pending" && due(e.expires)) {
      changes.push(upsert({ ...e, status: "timed_out" }));
      effects.push({ kind: "expired", id: e.id });
    }
    if (e.kind === "question" && e.status === "open" && due(e.expires)) {
      changes.push(upsert({ ...e, status: "timed_out" }));
      effects.push({ kind: "settled", id: e.id, answer: { kind: "timed_out" } });
    }
    if (e.kind === "schedule" && e.status === "active" && !e.running && due(e.next)) {
      const next = e.when.kind === "once" ? null : nextRun(e.when, now);
      const moved: Schedule = { ...e, next, status: next ? "active" : "done" };
      if (Date.parse(now) - Date.parse(e.next) > GRACE_MS) {
        changes.push(upsert({ ...moved, last: { at: e.next, outcome: "missed", summary: "remuse was not running at the time" } }));
      } else {
        const running: Schedule = { ...moved, running: true };
        changes.push(upsert(running));
        effects.push({ kind: "run", schedule: running });
      }
    }
  }
  return { changes, effects };
}

/**
 * After a restart nothing is mid-run any more: streaming replies end where
 * they stopped, browser runs and tasks in flight are stopped (nothing drives
 * them now) and no browser is live, pending approvals time out (nobody waits on them), and the
 * activity line clears.
 */
export function recover(state: State, now: string): Change[] {
  const settle = (e: Entity): Entity | null => {
    switch (e.kind) {
      case "reply":
        return e.streaming ? { ...e, streaming: false } : null;
      case "browser": {
        // the pool lets go of every browser on start: none is live after a restart; a job that was on is cut short
        const status = terminalBrowser.includes(e.status) || e.status === "idle" ? e.status : onJob(e) ? "stopped" : "idle";
        return status === e.status && !e.live && e.step === null ? null : { ...e, status, step: null, live: false };
      }
      case "task":
        return runningTask.includes(e.status) ? { ...e, status: "stopped" } : null;
      case "approval":
        return e.status === "pending" ? { ...e, status: "timed_out" } : null;
      case "question":
        return e.status === "open" ? { ...e, status: "closed" } : null;
      case "instruction":
      case "failure":
        return null;
      case "schedule":
        return e.running ? { ...e, running: false, last: { at: now, outcome: "failed", summary: "cut short by a restart" } } : null; // ended now, as far as anyone can tell
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
