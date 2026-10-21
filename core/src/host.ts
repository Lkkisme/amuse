/**
 * Runs the conversations: the main chat and side chats, each with its own
 * event log; decides client commands, and hands effects to the ports. Ports
 * say things (replies, activity) and change anything else by acting through
 * the rules, like clients do.
 * The host is a Session, so a transport only frames it (api/) or a client
 * uses it in-process (web demo, tests).
 */
import {
  type Account,
  type Attachment,
  type Permission,
  type KindRule,
  type ToolKind,
  type Browser,
  type Chat,
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
  MAIN,
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
import { type Budget, type Where, agentContext, budget, mentions, recall } from "./context.ts";

/**
 * What ports may record directly: what the agent says (its replies, streamed)
 * and what it is doing (the activity line). Everything else is an action.
 */
export type Say = { kind: "upserted"; entity: Reply } | Extract<Change, { kind: "appended" | "activity" }>;
export type Emit = (say: Say) => void;

/** Ids that stay unique across restarts and processes (a journal outlives any counter). */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export type Acted = { ok: true; id: string } | { ok: false; rejection: Rejection };

/** A chat as the agent knows the others. */
export interface ChatInfo {
  id: string;
  title: string;
  main: boolean;
  updated: string;
}

/**
 * What ports and agents can do in one chat: say things, act through the
 * rules, wait for an approval, and wake the chat's agent with a note (not
 * shown as a user message), e.g. a finished run's result.
 */
export interface AgentIO {
  /** the chat this is for (MAIN or a side chat's id) */
  chat: string;
  emit: Emit;
  act(action: AgentAction): Acted;
  /** The chat so far, as the agent should know it (context.ts): newest in full, older in brief. */
  context(): string;
  /** Search this chat however old; `everywhere`: every chat. */
  recall(query: string, everywhere?: boolean): string;
  /** The chats there are. */
  chats(): ChatInfo[];
  /** Another chat as the agent would know it, by id; null if there is none. */
  readChat(id: string): string | null;
  /** Resolves when the user decides approval `id` (from an `ask`), or it times out; at once if already settled. */
  decision(id: string): Promise<Answer>;
  /** Wake the chat agent with a note from background work. */
  report(note: string): void;
  /** Now, and the user's time zone (their device's when they last wrote). */
  time(): { now: string; timezone: string };
  /** What the user last said in this chat (or, before they have, in the main chat); "" before they ever have. */
  lastWords(): string;
  /** Resolves when Muse answers question `id` (from a `question` action), it times out, or its run ends. */
  answer(id: string): Promise<QuestionOutcome>;
  /** What Muse tells run `run` while it is in flight (instructions; a stop for a schedule's run). Returns unsubscribe. */
  listen(run: string, listener: (message: RunMessage) => void): () => void;
}

/** What a run in flight hears from Muse. */
export type RunMessage = { kind: "instruction"; text: string } | { kind: "stop" };

/** The outside world. Every port gets the AgentIO of the chat the work belongs to. */
export interface Ports {
  /** Run the chat's agent: on what the user just said (already in the chat), or on a note from background work. */
  prompt(turn: Turn, io: AgentIO): void;
  /** Stop the chat's agent's current run. */
  interrupt(io: AgentIO): void;
  /** A short title for a side chat, from its first message. */
  title(text: string): Promise<string>;
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
  /** Muse's workspace: the files it and the user share. */
  files: Workspace;
}

/** A file or folder in the workspace. */
export interface Entry {
  path: string;
  kind: "file" | "folder";
  /** bytes (0 for a folder) */
  size: number;
  modified: string;
}

/** A workspace operation that cannot be done, in words for the agent (no such file, outside the workspace, …). */
export class WorkspaceError extends Error {}

/**
 * Muse's workspace: a folder of real files that Muse and the user share.
 * What the user sends lands in user/ (pictures and videos in
 * user/media_library/), the browser's downloads in downloads/, and the rest
 * is Muse's own. Paths are relative to the workspace and never leave it.
 * A file sent in the chat is an attachment: an id the chat keeps, pointing
 * at the file where it is now (nowhere, once deleted).
 */
export interface Workspace {
  /** Whether `attachment` is a file sent here, as it says (name, type and size). */
  holds(attachment: Attachment): Promise<boolean>;
  /** A sent file and its bytes, by its id; null when it is gone. */
  read(id: string): Promise<{ attachment: Attachment; data: Uint8Array } | null>;
  /** What is in a folder ("" for the top). */
  list(folder: string): Promise<Entry[]>;
  /** A file's bytes and what kind of file it is. */
  open(path: string): Promise<{ path: string; type: string; size: number; data: Uint8Array }>;
  /** Write a file (its folders are made); an existing one only with `overwrite`. */
  write(path: string, data: Uint8Array, overwrite: boolean): Promise<void>;
  /** Move or rename a file or folder; never onto something that exists. */
  move(from: string, to: string): Promise<void>;
  /** Delete a file or folder (and what is in it). */
  remove(path: string): Promise<void>;
  /** Whether a file or folder is there. */
  exists(path: string): Promise<boolean>;
  /** Where a sent file is now; null once it is deleted. */
  locate(id: string): string | null;
  /** A workspace file as an attachment, to send in the chat. */
  share(path: string): Promise<Attachment>;
}

/** No workspace: where no files are kept (the demo, tests). */
export const noWorkspace: Workspace = {
  holds: async () => false,
  read: async () => null,
  list: async () => [],
  exists: async () => false,
  locate: () => null,
  open: async (path) => {
    throw new WorkspaceError(`there is no ${path}: no files are kept here`);
  },
  write: async () => {
    throw new WorkspaceError("no files are kept here");
  },
  move: async () => {
    throw new WorkspaceError("no files are kept here");
  },
  remove: async () => {
    throw new WorkspaceError("no files are kept here");
  },
  share: async () => {
    throw new WorkspaceError("no files are kept here");
  },
};

/** What wakes the agent: the user's message (with any files), or a note from its background work (not shown as a message). */
export type Turn = { kind: "message"; text: string; attachments: Attachment[] } | { kind: "note"; text: string };

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
    case "noChat":
      return `no chat ${rejection.id}`;
    case "noFile":
      return `file ${rejection.id} was not uploaded here`;
    case "mainChat":
      return "the main chat cannot be renamed or deleted";
    case "invalid":
      return `cannot ${rejection.action} from ${rejection.from}`;
  }
}

export interface Clock {
  now(): string;
}

/** Where a chat's event log survives restarts. The host replays it on start and appends every event. */
export interface Journal {
  load(): Envelope[];
  append(envelope: Envelope): void;
}

/** Where the chats survive restarts: the list of them, and each one's log. */
export interface ChatStore {
  /** the chats there were (the main chat is added if missing) */
  load(): Chat[];
  save(chats: Chat[]): void;
  journal(chat: string): Journal;
  /** let go of a deleted chat's log */
  remove(chat: string): void;
}

/** Chats kept in memory only (the demo, tests). */
export function memoryChats(): ChatStore {
  let chats: Chat[] = [];
  const logs = new Map<string, Envelope[]>();
  return {
    load: () => chats,
    save: (next) => void (chats = next),
    journal: (chat) => ({
      load: () => logs.get(chat) ?? [],
      append: (envelope) => void logs.set(chat, [...(logs.get(chat) ?? []), envelope]),
    }),
    remove: (chat) => void logs.delete(chat),
  };
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
  /** what the main chat starts with when it has no history */
  seed?: Entity[];
  clock?: Clock;
  store?: ChatStore;
  ids?: (prefix: string) => string;
  /** Entities a snapshot holds (more while older ones are still in play); older ones come by session.history. */
  snapshot?: number;
  /** What wakes the host when a schedule or an approval falls due (real timers by default). */
  timers?: Timers<unknown>;
}

/** setTimeout's longest wait (about 24.8 days); a later deadline is woken for and looked at again. */
const LONGEST_WAIT = 2 ** 31 - 1;

/** How much of another chat the agent reads at once. */
const otherChat: Budget = { full: 12_000, brief: 4_000 };

/** One chat as the host keeps it: the whole feed (clients may ask for any of it), its log, and its agent's IO. */
interface Room {
  chat: Chat;
  state: State;
  log: Envelope[];
  journal: Journal;
  agent: AgentIO;
}

/** The entity an agent action is about, if it is about one that exists (its chat is where it is recorded). */
function subjectOf(action: AgentAction): string | null {
  switch (action.kind) {
    case "browserStatus":
    case "browserStep":
    case "browserEnded":
    case "released":
    case "taskStatus":
    case "connected":
    case "unschedule":
    case "scheduleRan":
    case "answer":
      return action.id;
    case "instruct":
    case "stopRun":
    case "question":
      return action.run;
    case "connect":
    case "browse":
    case "ask":
    case "schedule":
      return null;
  }
}

export function createHost(ports: Ports, options: HostOptions = {}): Session {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const snapshot = options.snapshot ?? 50;
  const store = options.store ?? memoryChats();
  const ids = options.ids ?? newId;
  const rooms = new Map<string, Room>();
  const listeners = new Set<(update: Update) => void>();
  const push = (update: Update) => listeners.forEach((listener) => listener(update));

  /** The main chat first, then side chats, most recently used first. */
  const ordered = (): Chat[] => {
    const all = [...rooms.values()].map((r) => r.chat);
    return [...all.filter((c) => c.id === MAIN), ...all.filter((c) => c.id !== MAIN).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))];
  };
  const saveChats = () => {
    const chats = ordered();
    store.save(chats);
    push({ kind: "chats", chats });
  };
  const main = (): Room => {
    const room = rooms.get(MAIN);
    if (!room) throw new Error("the main chat is missing");
    return room;
  };
  const roomOf = (chat: string): Room => {
    const room = rooms.get(chat);
    if (!room) throw new Rejected({ kind: "noChat", id: chat });
    return room;
  };
  /** The chat an entity is in (ids are unique across chats). */
  const holder = (id: string): Room | undefined => [...rooms.values()].find((r) => r.state.entities.some((e) => e.id === id));

  const record = (room: Room, envelope: Envelope) => {
    room.state = apply(room.state, envelope);
    room.log.push(envelope);
  };
  /** Every change is recorded here; ports only reach the Say subset of them (AgentIO.emit). */
  const commit = (room: Room, change: Change) => {
    const envelope = { seq: room.state.seq + 1, event: place(room.state, change) };
    record(room, envelope);
    room.journal.append(envelope);
    push({ kind: "event", chat: room.chat.id, envelope });
    if (change.kind !== "upserted") return;
    arm(); // only an entity can move a deadline
    // something said moves the chat up the list
    const { entity } = change;
    if (entity.kind === "prompt" || (entity.kind === "reply" && !entity.streaming)) {
      room.chat = { ...room.chat, updated: clock.now() };
      saveChats();
    }
  };

  /** One timer, for the earliest deadline in any chat; when it fires, whatever is due happens (decide.ts `tick`). */
  const timers = options.timers ?? realTimers;
  let armed: { at: string; handle: unknown } | null = null;
  function arm(): void {
    const at = [...rooms.values()].map((r) => deadline(r.state)).reduce<string | null>((a, b) => (b !== null && (a === null || Date.parse(b) < Date.parse(a)) ? b : a), null);
    if (armed?.at === at) return;
    if (armed) timers.clear(armed.handle);
    armed = null;
    if (at === null) return;
    const wait = Math.min(Math.max(0, Date.parse(at) - Date.parse(clock.now())), LONGEST_WAIT);
    armed = { at, handle: timers.set(wait, fire) };
  }
  function fire(): void {
    armed = null;
    for (const room of [...rooms.values()]) {
      const due = tick(room.state, clock.now());
      due.changes.forEach((change) => commit(room, change));
      due.effects.forEach((effect) => run(room, effect));
    }
    arm();
  }

  const context = (): Context => ({ now: clock.now(), id: ids });
  /** Where the chat's files are now, as the agent is told. */
  const where: Where = (a) => ports.files.locate(a.id);

  /** Callers waiting on an approval, settled when the user resolves it. */
  const waiting = new Map<string, ((answer: Answer) => void)[]>();
  const settle = (id: string, outcome: Answer) => {
    waiting.get(id)?.forEach((resolve) => resolve(outcome));
    waiting.delete(id);
  };
  /** Runs waiting on their questions, and runs listening for Muse. */
  const asking = new Map<string, ((outcome: QuestionOutcome) => void)[]>();
  const answered = (id: string, outcome: QuestionOutcome) => {
    asking.get(id)?.forEach((resolve) => resolve(outcome));
    asking.delete(id);
  };
  const listening = new Map<string, Set<(message: RunMessage) => void>>();
  const tell = (run: string, message: RunMessage) => listening.get(run)?.forEach((listener) => listener(message));

  const titled = (chat: Chat) => (chat.id === MAIN ? "Main chat" : chat.title || "New chat");

  /** A chat's AgentIO: what its agent and the work it starts can do (`at`: the chat's room, once it exists). */
  function agentOf(chat: string, at: () => Room): AgentIO {
    const io: AgentIO = {
      chat,
      emit: (say) => commit(at(), say),
      decision(id) {
        const approval = holder(id)?.state.entities.find((e) => e.kind === "approval" && e.id === id);
        if (approval?.kind === "approval" && approval.status !== "pending") return Promise.resolve({ verdict: approval.status, remember: false });
        return new Promise((resolve) => waiting.set(id, [...(waiting.get(id) ?? []), resolve]));
      },
      report: (note) => {
        // a chat deleted meanwhile has no one to tell
        if (rooms.get(chat) === at()) ports.prompt({ kind: "note", text: note }, io);
      },
      context: () => agentContext(at().state, budget, where),
      recall(query, everywhere = false) {
        const room = at();
        if (!everywhere) return recall(room.state, query, 10, where);
        const found = [room, ...[...rooms.values()].filter((r) => r !== room)].flatMap((r) => {
          const lines = mentions(r.state, query, 10, where);
          return lines.length === 0 ? [] : [`In ${r === room ? "this chat" : `"${titled(r.chat)}" (${r.chat.id})`}:\n${lines.join("\n")}`];
        });
        return found.length > 0 ? found.join("\n\n") : `Nothing in any chat mentions "${query}".`;
      },
      chats: () => ordered().map((c) => ({ id: c.id, title: titled(c), main: c.id === MAIN, updated: c.updated })),
      readChat: (id) => {
        const other = rooms.get(id);
        return other ? agentContext(other.state, otherChat, where) || "(nothing said yet)" : null;
      },
      time: () => ({ now: clock.now(), timezone: userZoneOf(at()) }),
      lastWords: () => {
        const said = (r: Room) => r.state.entities.findLast((e) => e.kind === "prompt" && e.text.trim() !== "");
        const last = said(at()) ?? said(main());
        return last?.kind === "prompt" ? last.text : "";
      },
      answer(id) {
        const question = holder(id)?.state.entities.find((e) => e.kind === "question" && e.id === id);
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
        // recorded where its subject is; a schedule always in the main chat (its runs report there)
        const subject = subjectOf(action);
        const target = action.kind === "schedule" ? main() : ((subject !== null ? holder(subject) : undefined) ?? at());
        const decision = decideAgent(target.state, action.kind, action, context());
        if (!decision.ok) return decision;
        decision.changes.forEach((change) => commit(target, change));
        decision.effects.forEach((effect) => run(target, effect));
        return { ok: true, id: decision.output.id };
      },
    };
    return io;
  }
  /** The user's time zone: their device's when they last wrote, in this chat or, failing that, the main one. */
  const userZoneOf = (room: Room) => (room.state.entities.some((e) => e.kind === "prompt") ? userZone(room.state) : userZone(main().state));

  function run(room: Room, effect: Effect): void {
    const { agent } = room;
    switch (effect.kind) {
      case "prompt":
        return ports.prompt({ kind: "message", text: effect.text, attachments: effect.attachments }, agent);
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
        return answered(effect.id, effect.answer);
    }
  }

  /** Decide in a chat, record, then act. A rejection becomes a Rejected error. */
  const command = <M extends Command["method"]>(room: Room, method: M, params: Params[M]) => {
    const decision = decide(room.state, { method, params }, context());
    if (!decision.ok) throw new Rejected(decision.rejection);
    decision.changes.forEach((change) => commit(room, change));
    decision.effects.forEach((effect) => run(room, effect));
    return decision.output;
  };
  /** A command about an entity, in the chat it is in (or the main chat, to be refused there). */
  const about = <M extends Command["method"]>(id: string, method: M, params: Params[M]) => command(holder(id) ?? main(), method, params);

  const open = (chat: Chat): Room => {
    const room: Room = { chat, state: empty, log: [], journal: store.journal(chat.id), agent: agentOf(chat.id, () => room) };
    rooms.set(chat.id, room);
    return room;
  };

  // every chat's journal is replayed; the main chat's seed only when it has no history
  const now = clock.now();
  const stored = store.load();
  const chats = stored.some((c) => c.id === MAIN) ? stored : [{ id: MAIN, title: "", at: now, updated: now }, ...stored];
  for (const chat of chats) {
    const room = open(chat);
    const history = room.journal.load();
    history.forEach((envelope) => record(room, envelope));
    recover(room.state, now).forEach((change) => commit(room, change));
    if (chat.id === MAIN && history.length === 0) for (const entity of options.seed ?? []) commit(room, { kind: "upserted", entity });
  }
  if (!stored.some((c) => c.id === MAIN)) store.save(ordered());
  arm(); // what fell due while remuse was down happens now (or is recorded as missed)

  /** A side chat with no title yet is named after its first message. */
  const nameAfter = (room: Room, text: string) => {
    if (room.chat.id === MAIN || room.chat.title || room.state.entities.filter((e) => e.kind === "prompt").length !== 1) return;
    void ports.title(text).then(
      (title) => {
        const clean = title.trim().replace(/^["'“”]+|["'“”.]+$/g, "").slice(0, 80);
        if (!clean || rooms.get(room.chat.id) !== room || room.chat.title) return;
        room.chat = { ...room.chat, title: clean };
        saveChats();
      },
      () => {},
    );
  };

  /** Delete a side chat: what runs in it is stopped, whoever waits on it hears no, then it is gone. */
  const remove = (room: Room) => {
    ports.interrupt(room.agent);
    for (const e of room.state.entities) {
      if (e.kind === "browser" && ["queued", "working", "waiting", "needs_you", "paused"].includes(e.status)) {
        const stopped = decide(room.state, { method: "browser.control", params: { id: e.id, action: "stop" } }, context());
        if (stopped.ok) stopped.effects.forEach((effect) => run(room, effect));
      }
      if (e.kind === "approval" && e.status === "pending") settle(e.id, { verdict: "denied", remember: false });
      if (e.kind === "question" && e.status === "open") answered(e.id, { kind: "closed" });
    }
    rooms.delete(room.chat.id);
    store.remove(room.chat.id);
    saveChats();
    arm();
  };

  const handlers: Handlers = {
    "session.sync": async ({ chat, since }) => {
      const { state, log } = roomOf(chat);
      return since !== null && since <= state.seq && (log[0]?.seq ?? 1) <= since + 1
        ? { kind: "events", events: log.filter((e) => e.seq > since) }
        : { kind: "snapshot", state: recent(state, snapshot) };
    },
    "session.history": async ({ chat, before, limit }) => {
      const { state } = roomOf(chat);
      const end = Math.min(before, state.entities.length);
      const start = Math.max(0, end - limit);
      return { seq: state.seq, earlier: start, entities: state.entities.slice(start, end) };
    },
    "chat.send": async (params) => {
      const room = roomOf(params.chat);
      // a file is sent as uploaded, or not at all
      for (const attachment of params.attachments) if (!(await ports.files.holds(attachment))) throw new Rejected({ kind: "noFile", id: attachment.id });
      const sent = command(room, "chat.send", params);
      nameAfter(room, params.text);
      return sent;
    },
    "chat.stop": async (params) => command(roomOf(params.chat), "chat.stop", params),
    "chats.list": async () => ({ chats: ordered() }),
    "chats.create": async () => {
      const at = clock.now();
      const room = open({ id: ids("c"), title: "", at, updated: at });
      saveChats();
      return room.chat;
    },
    "chats.rename": async ({ id, title }) => {
      if (id === MAIN) throw new Rejected({ kind: "mainChat" });
      const room = roomOf(id);
      room.chat = { ...room.chat, title };
      saveChats();
      return null;
    },
    "chats.delete": async ({ id }) => {
      if (id === MAIN) throw new Rejected({ kind: "mainChat" });
      remove(roomOf(id));
      return null;
    },
    "approval.resolve": async (params) => about(params.id, "approval.resolve", params),
    "connection.begin": async (params) => {
      const room = holder(params.id) ?? main();
      return { url: await ports.connect(command(room, "connection.begin", params), room.agent) };
    },
    "connection.dismiss": async (params) => about(params.id, "connection.dismiss", params),
    "browser.control": async (params) => about(params.id, "browser.control", params),
    "browser.fit": async (params) => about(params.id, "browser.fit", params),
    "task.stop": async (params) => about(params.id, "task.stop", params),
    "schedules.list": async () => ({
      schedules: [...rooms.values()].flatMap((r) => r.state.entities.filter((e): e is Schedule => e.kind === "schedule")).reverse(),
    }),
    "schedule.control": async (params) => about(params.id, "schedule.control", params),
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
