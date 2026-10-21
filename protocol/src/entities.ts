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
 * Muse's browser task statuses. Takeover is a status, not a flag: paused
 * means the user controls the browser.
 *   waiting    the agent asked something in chat (shown "Waiting for you")
 *   needs_you  the user must act in the browser ("Action required")
 */
export const BrowserStatus = z.enum(["queued", "working", "waiting", "needs_you", "paused", "completed", "failed", "stopped"]);

export const Browser = z.object({
  kind: z.literal("browser"),
  id: Id,
  at: Instant,
  title: z.string(),
  url: z.url(),
  status: BrowserStatus,
  /** what the user asked of this run, in full: what to do and what not to (the title is only its name) */
  instructions: z.string(),
  /** how it ended, in a few words, once it has (completed or failed); null before */
  result: z.string().nullable(),
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
 * quiet (nothing worth saying), failed, stopped (by Muse), or missed (remuse was not running
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

export const Entity = z.discriminatedUnion("kind", [Prompt, Reply, Task, Approval, Connection, Browser, Schedule, Instruction, Question]);

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
export type Task = z.infer<typeof Task>;
export type Approval = z.infer<typeof Approval>;
export type Connection = z.infer<typeof Connection>;
export type Browser = z.infer<typeof Browser>;
export type Schedule = z.infer<typeof Schedule>;
export type Instruction = z.infer<typeof Instruction>;
export type Question = z.infer<typeof Question>;
export type When = z.infer<typeof When>;
export type RunOutcome = z.infer<typeof RunOutcome>;
export type BrowserStatus = z.infer<typeof BrowserStatus>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Resolution = z.infer<typeof Resolution>;
export type Entity = z.infer<typeof Entity>;
export type Activity = z.infer<typeof Activity>;
