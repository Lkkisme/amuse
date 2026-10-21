/**
 * Everything the chat shows is an entity. The feed is entities in order of
 * first appearance; cards are just entities that are not messages.
 * Every union is discriminated by `kind`.
 */
import { z } from "zod";

export const Id = z.string().min(1);
/** ISO-8601 instant, UTC. */
export const Instant = z.iso.datetime();

/** An IANA time zone, e.g. "Asia/Shanghai". */
export const TimeZone = z.string().min(1);

/**
 * A file sent in the chat (by the user, or by Muse): a file in Muse's
 * workspace, known to the chat by its id, which keeps pointing at the file
 * if it moves (and at nothing once it is deleted).
 */
export const Attachment = z.object({
  id: Id,
  name: z.string().min(1).max(255),
  /** MIME type, e.g. "image/png"; "application/octet-stream" when unknown */
  type: z.string().min(1).max(255),
  /** bytes */
  size: z.int().nonnegative(),
  /** where it was in the workspace when sent, e.g. "user/media_library/receipt.png" */
  path: z.string().min(1).max(1024),
});

/** What the user said, and where they were: their device's time zone, which is the user's time zone from then on. */
export const Prompt = z.object({
  kind: z.literal("prompt"),
  id: Id,
  at: Instant,
  /** may be empty when files say it all */
  text: z.string(),
  timezone: TimeZone,
  /** files sent with it, in order (prompts from before files could be sent have none) */
  attachments: z.array(Attachment).default([]),
});

/** What the agent said, with any files it sent; `streaming` until its last delta has arrived. */
export const Reply = z.object({
  kind: z.literal("reply"),
  id: Id,
  at: Instant,
  text: z.string(),
  streaming: z.boolean(),
  attachments: z.array(Attachment).default([]),
});

export const Step = z.object({ label: z.string(), done: z.boolean() });

/** waiting: it asked the user something in chat and is blocked on the answer. */
export const TaskStatus = z.enum(["queued", "working", "waiting", "completed", "failed", "stopped"]);

/**
 * Work Muse hands to a background helper (a general agent) while the chat goes
 * on: long work it can do on its own, or one of several things done at once.
 */
export const Task = z.object({
  kind: z.literal("task"),
  id: Id,
  at: Instant,
  title: z.string(),
  /** its plan, as the helper keeps it */
  steps: z.array(Step),
  status: TaskStatus,
  /** what it was asked, in full */
  instructions: z.string().default(""),
  /** how it ended, in a few words, once it has (completed or failed); null before */
  result: z.string().nullable().default(null),
});

/** How the user answers an approval; the *_always / session ones also create a rule. */
export const Resolution = z.enum(["allow_once", "allow_session", "allow_always", "deny", "deny_always"]);

/** An outbound action the policy says to ask about; unanswered by `expires`, it times out (no). */
export const Approval = z.object({
  kind: z.literal("approval"),
  id: Id,
  at: Instant,
  action: z.string(),
  target: z.string(),
  detail: z.string(),
  /** whether the answer can be kept as a rule for next time (offer "always"); only actions a rule can name */
  remember: z.boolean(),
  status: z.enum(["pending", "approved", "denied", "timed_out"]),
  expires: Instant,
  /** the app it is for (e.g. "gmail"), shown with its logo; null: not an app's */
  app: z.string().nullable().default(null),
  /** the answer was for good (it became a rule) */
  always: z.boolean().default(false),
  /** refused by the user's rule, not asked and not answered: it never was a card (it ends denied, and is only a record) */
  byRule: z.boolean().default(false),
});

/** The agent asking the user to connect an app (provider: e.g. "gmail"). */
export const Connection = z.object({
  kind: z.literal("connection"),
  id: Id,
  at: Instant,
  provider: z.string(),
  title: z.string(),
  status: z.enum(["pending", "connected", "dismissed"]),
});

/**
 * Where a credential the user gives for Amuse's sandbox goes: an environment variable every command there gets, a file
 * in its home, or typed into a terminal (a pane of herdr's, w1:p2, where a CLI waits for a code). Typing went to a
 * running service's input before terminals were herdr's: such a `service` is read as the pane it names (none, now).
 */
export const SecretDestination = z.preprocess(
  (raw) =>
    typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "stdin" && "service" in raw && !("pane" in raw)
      ? { kind: "stdin", pane: raw.service }
      : raw,
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("env"), name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/) }),
    z.object({ kind: z.literal("file"), path: z.string().min(1).max(1024) }),
    z.object({ kind: z.literal("stdin"), pane: z.string().min(1).max(60) }),
  ]),
);
export type SecretDestination = z.infer<typeof SecretDestination>;

/**
 * The agent asking the user for a credential for its sandbox (an API key, a
 * login code). The user types it on the card; it goes from there to the
 * sandbox through the server, never through the agent, the chat or this
 * entity, which keeps only that it was asked and how it was answered.
 */
export const SecretRequest = z.object({
  kind: z.literal("secret"),
  id: Id,
  at: Instant,
  /** what it is, as the user knows it ("OpenAI API key") */
  name: z.string(),
  /** what it is for */
  why: z.string(),
  deliver: SecretDestination,
  status: z.enum(["pending", "provided", "declined"]),
});

/**
 * A browser's statuses. Takeover is a status, not a flag: paused means the
 * user controls the browser.
 *   working    its agent is on a job
 *   waiting    the agent asked something in chat (shown "Waiting for you")
 *   needs_you  the user must act in the browser ("Action required")
 *   idle       open, between jobs: its agent waits for the next one
 *   stopped    closed by the user (or Muse) in the middle of things
 *   completed, failed  how a job ended, from before browsers stayed open between jobs
 */
export const BrowserStatus = z.enum(["queued", "working", "waiting", "needs_you", "paused", "idle", "completed", "failed", "stopped"]);

/**
 * A browser and its own agent, one for the other, from opening to closing
 * (Muse's browser tasks open one; the user can open one of their own). It
 * does one job at a time and stays open between them, remembering what
 * happened in it, until it is closed (or has stood idle a while).
 */
export const Browser = z.object({
  kind: z.literal("browser"),
  id: Id,
  at: Instant,
  /** the current (or last) job's name; "Your browser" for one the user opened */
  title: z.string(),
  url: z.url(),
  status: BrowserStatus,
  /** the current (or last) job in full: what to do and what not to; "" before it has had one */
  instructions: z.string(),
  /** how the last job ended, in a few words; null while one is on (or before any) */
  result: z.string().nullable(),
  /** whether the last job was done or could not be */
  outcome: z.enum(["completed", "failed"]).nullable().default(null),
  /** what its agent is doing right now ("Opening page"), while it works; null otherwise */
  step: z.string().nullable(),
  /** the run still has its browser, to watch and take over; once it is gone the card is only a record */
  live: z.boolean(),
  /** workspace files the run was given to upload (each upload still asks the user); none by default */
  files: z.array(z.string()).default([]),
});

/** When a schedule runs: on a cron pattern (5 fields) in a time zone, or once. */
export const When = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("repeat"), cron: z.string(), timezone: TimeZone }),
  z.object({ kind: z.literal("once"), at: Instant }),
]);

/**
 * How a schedule's run went: reported (it told the conversation something),
 * quiet (nothing worth saying), failed, stopped (by Muse), or missed (amuse was not running
 * then, and it was too late to catch up).
 */
export const RunOutcome = z.enum(["reported", "quiet", "failed", "missed", "stopped"]);

/**
 * Work the agent set up to run later or regularly (a daily briefing, an
 * hourly look at the mail). Each run is a background agent given
 * `instructions`; it tells the conversation only what is worth telling.
 *   active     runs at `next`
 *   paused     by the user; resumes from then on, nothing caught up
 *   done       a one-off that has run
 *   cancelled  for good
 */
/**
 * When a schedule's run is worth starting at all (checked before any work):
 *   conversation  there was conversation since its last run
 *   lull          there was, it has gone quiet (20 minutes), and the last run is 4 hours back
 * A run its condition holds back is skipped, and not counted as a run.
 */
export const Needs = z.enum(["conversation", "lull"]);
export type Needs = z.infer<typeof Needs>;

export const Schedule = z.object({
  kind: z.literal("schedule"),
  id: Id,
  at: Instant,
  title: z.string(),
  instructions: z.string(),
  when: When,
  status: z.enum(["active", "paused", "done", "cancelled"]),
  /** the next run while active; null otherwise */
  next: Instant.nullable(),
  /** a run is under way */
  running: z.boolean(),
  /** how the latest run went, in a few words; null before the first */
  last: z.object({ at: Instant, outcome: RunOutcome, summary: z.string() }).nullable(),
  /** what a run waits for besides its time; null: nothing */
  needs: Needs.nullable().default(null),
  /** one every instance starts with (not asked for in the chat, so not shown there); the user's like any other */
  preset: z.boolean().default(false),
  /** the user's goal it serves (its id, a folder in memory/goals/); null: none */
  goal: z.string().nullable().default(null),
});

/**
 * Muse telling one of its background runs (a browser task, a schedule's run)
 * something more while it works: a further instruction, a correction. The run
 * reads it before its next step. `run` is the browser's or the schedule's id.
 */
export const Instruction = z.object({
  kind: z.literal("instruction"),
  id: Id,
  at: Instant,
  run: Id,
  /** the run's title, as the user knows it */
  title: z.string(),
  text: z.string(),
});

/**
 * A background run asking something only the user can answer; Muse relays it
 * and answers it by its id. The run waits for the answer until `expires`.
 *   open       waiting for the answer
 *   answered   `answer` holds it
 *   timed_out  nobody answered in time; the run went on without
 *   closed     the run ended before an answer came
 */
export const Question = z.object({
  kind: z.literal("question"),
  id: Id,
  at: Instant,
  run: Id,
  title: z.string(),
  text: z.string(),
  status: z.enum(["open", "answered", "timed_out", "closed"]),
  answer: z.string().nullable(),
  expires: Instant,
});

/**
 * Muse could not reply: its model's provider refused (a content filter) or
 * failed. Not something Muse said, so not shown as its message; the turn it
 * was on is kept, to try again (status: open, until it is tried again).
 */
export const Failure = z.object({
  kind: z.literal("failure"),
  id: Id,
  at: Instant,
  reason: z.enum(["refused", "failed"]),
  /** the provider's own words, for the curious */
  detail: z.string(),
  /** what Muse was answering: the user's latest message, or a note from its background work */
  turn: z.discriminatedUnion("kind", [z.object({ kind: z.literal("message") }), z.object({ kind: z.literal("note"), text: z.string() })]),
  status: z.enum(["open", "retried"]),
});

export const Entity = z.discriminatedUnion("kind", [Prompt, Reply, Task, Approval, Connection, SecretRequest, Browser, Schedule, Instruction, Question, Failure]);

/**
 * What the agent is doing, shown under its name. `label` overrides the
 * default copy for the kind ("Re-observing page" instead of "Working").
 * Idle is no activity (null); approvals and connection health are derived
 * by the client, not sent.
 */
export const Activity = z.object({
  kind: z.enum(["responding", "working", "making", "compacting", "waiting_for_agents"]),
  label: z.string().nullable(),
});

export type Prompt = z.infer<typeof Prompt>;
export type Attachment = z.infer<typeof Attachment>;
export type Reply = z.infer<typeof Reply>;
export type SecretRequest = z.infer<typeof SecretRequest>;
export type Task = z.infer<typeof Task>;
export type Approval = z.infer<typeof Approval>;
export type Connection = z.infer<typeof Connection>;
export type Browser = z.infer<typeof Browser>;
export type Schedule = z.infer<typeof Schedule>;
export type Instruction = z.infer<typeof Instruction>;
export type Question = z.infer<typeof Question>;
export type Failure = z.infer<typeof Failure>;
export type When = z.infer<typeof When>;
export type RunOutcome = z.infer<typeof RunOutcome>;
export type BrowserStatus = z.infer<typeof BrowserStatus>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Resolution = z.infer<typeof Resolution>;
export type Entity = z.infer<typeof Entity>;
export type Activity = z.infer<typeof Activity>;
