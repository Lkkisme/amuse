/**
 * Everything the chat shows is an entity. The feed is entities in order of
 * first appearance; cards are just entities that are not messages.
 * Every union is discriminated by `kind`.
 */
import { z } from "zod";

export const Id = z.string().min(1);
/** ISO-8601 instant, UTC. */
export const Instant = z.iso.datetime();

/** What the user said. */
export const Prompt = z.object({
  kind: z.literal("prompt"),
  id: Id,
  at: Instant,
  text: z.string(),
});

/** What the agent said; `streaming` until its last delta has arrived. */
export const Reply = z.object({
  kind: z.literal("reply"),
  id: Id,
  at: Instant,
  text: z.string(),
  streaming: z.boolean(),
});

export const Step = z.object({ label: z.string(), done: z.boolean() });

/** A question the task needs answered; `answer` is null until it is. */
export const Question = z.object({ id: Id, label: z.string(), answer: z.string().nullable() });

export const Task = z.object({
  kind: z.literal("task"),
  id: Id,
  at: Instant,
  title: z.string(),
  steps: z.array(Step),
  questions: z.array(Question),
  /** waiting: blocked on unanswered questions */
  status: z.enum(["working", "waiting", "completed", "failed"]),
});

/** A side effect the policy says to ask about (Allow / Ask / Deny → Ask). */
export const Approval = z.object({
  kind: z.literal("approval"),
  id: Id,
  at: Instant,
  action: z.string(),
  target: z.string(),
  detail: z.string(),
  decision: z.enum(["pending", "approved", "denied"]),
});

/** The agent asking the user to connect an app. */
export const Connection = z.object({
  kind: z.literal("connection"),
  id: Id,
  at: Instant,
  app: z.string(),
  capability: z.string(),
  status: z.enum(["pending", "connected", "dismissed"]),
});

export const Controller = z.enum(["agent", "user"]);

/**
 * A browser run. Who controls it only means something while it is alive, so
 * a stopped run has no controller. waiting = it needs the user (Muse:
 * "Action required").
 */
export const BrowserState = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["working", "waiting", "completed"]), control: Controller }),
  z.object({ kind: z.literal("stopped") }),
]);

export const Browser = z.object({
  kind: z.literal("browser"),
  id: Id,
  at: Instant,
  title: z.string(),
  url: z.url(),
  state: BrowserState,
});

export const Entity = z.discriminatedUnion("kind", [Prompt, Reply, Task, Approval, Connection, Browser]);

/**
 * The line under the agent's name while it works, e.g. responding "is
 * responding", reading "Reading entry", operating "Re-observing page".
 */
export const Activity = z.object({
  kind: z.enum(["responding", "reading", "operating"]),
  label: z.string(),
});

export type Prompt = z.infer<typeof Prompt>;
export type Reply = z.infer<typeof Reply>;
export type Task = z.infer<typeof Task>;
export type Approval = z.infer<typeof Approval>;
export type Connection = z.infer<typeof Connection>;
export type Browser = z.infer<typeof Browser>;
export type BrowserState = z.infer<typeof BrowserState>;
export type Controller = z.infer<typeof Controller>;
export type Entity = z.infer<typeof Entity>;
export type Activity = z.infer<typeof Activity>;
