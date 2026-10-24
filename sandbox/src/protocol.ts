/**
 * What the sandbox's control daemon and its client say to each other: JSON
 * over HTTP, checked with these schemas on both sides. What the daemon says is
 * not taken for trusted (a process in the sandbox could stand in for it), so
 * what could carry words into the agent's context is held to a plain shape. A command is run to
 * completion (`POST /run`), or as a job of a chat that is handed off to the background if it takes long (`/jobs`); what goes on
 * running to be watched or typed into is in herdr's terminals (`/terminal`, for the user to see).
 * The daemon also keeps credentials the user gave for the sandbox (`/secrets`) and empties the sandbox's
 * home on request (`POST /reset`).
 */
import { z } from "zod";

/** Where the daemon listens, unless told otherwise. */
export const PORT = 7070;
/** A command that runs to completion is stopped after this many seconds, unless it asks for another; and never after more than the longest. */
export const DEFAULT_TIMEOUT = 120;
export const LONGEST_TIMEOUT = 600;

export const Run = z.object({
  command: z.string().min(1).max(100_000),
  /** a folder; relative to the workspace (the default) */
  cwd: z.string().max(4096).optional(),
  /** seconds */
  timeout: z.int().min(1).max(LONGEST_TIMEOUT).optional(),
});
export type Run = z.infer<typeof Run>;

/** How a command went: what it printed (both streams, in the order it came, clipped), and how it ended. */
/** A signal's name (SIGTERM). */
const Signal = z.string().regex(/^SIG[A-Z0-9]{1,12}$/);

export const Ran = z.object({
  output: z.string(),
  /** characters of output left out of the middle */
  cut: z.int().min(0),
  exitCode: z.int().nullable(),
  /** the signal that ended it, if one did */
  signal: Signal.nullable(),
  timedOut: z.boolean(),
});
export type Ran = z.infer<typeof Ran>;

/** How long a job is waited for before it is handed off to the background, how long one may live, and how many a chat may have running. */
export const HANDOFF_SECONDS = 10;
export const JOB_LIFETIME = 1800;
export const MAX_JOBS = 4;

/** A chat's id, as the daemon keeps its jobs by it. */
export const ChatId = z.string().min(1).max(100);

/** A job of a chat: a command that outlives the request that started it. */
export const Start = z.object({
  chat: ChatId,
  command: z.string().min(1).max(100_000),
  cwd: z.string().max(4096).optional(),
  /** hand it off at once, without the wait for it to end */
  background: z.boolean().optional(),
});
export type Start = z.infer<typeof Start>;

export const JobId = z.string().regex(/^j\d{1,9}$/);
/** A job of a chat, by its id; for one of that chat's jobs only. */
export const JobRef = z.object({ chat: ChatId, id: JobId });
export type JobRef = z.infer<typeof JobRef>;
/** Stopping jobs: one, or without an id every one of the chat's. */
export const StopJobs = z.object({ chat: ChatId, id: JobId.optional() });
export type StopJobs = z.infer<typeof StopJobs>;

/** Why a job ended: it ran out, hit the lifetime, was stopped on request, or the sandbox was reset. */
export const JobEnd = z.object({
  exitCode: z.int().nullable(),
  signal: Signal.nullable(),
  reason: z.enum(["finished", "timedOut", "stopped", "reset"]),
});
export type JobEnd = z.infer<typeof JobEnd>;

/** A job as it stands: what it printed so far (clipped as a command's is), for how long it has run, and how it ended if it has. */
export const JobState = z.object({
  id: JobId,
  running: z.boolean(),
  /** seconds it has run (to its end, once it has) */
  seconds: z.int().min(0),
  output: z.string(),
  cut: z.int().min(0),
  end: JobEnd.nullable(),
});
export type JobState = z.infer<typeof JobState>;
export const JobStates = z.object({ jobs: z.array(JobState) });

/** Why a request was not done, in the daemon's words (which the client does not pass on as its own). */
export const Failure = z.object({ error: z.string() });

/** An answer that says only that it is done. */
export const Nothing = z.object({});

/** A credential for commands here, as an environment variable every command gets. */
export const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/);
export const SecretEnv = z.object({ name: EnvName, value: z.string().min(1).max(20_000) });
export type SecretEnv = z.infer<typeof SecretEnv>;

/** A credential written to a file in the home folder (never the workspace, which the user and Amuse's own tools read). */
export const SecretFile = z.object({
  path: z.string().min(1).max(1024),
  value: z.string().min(1).max(200_000),
  /** `base64`: the value is the file's bytes in base64 (a keystore is not text); `utf8` (the default): the text itself */
  encoding: z.enum(["utf8", "base64"]).optional(),
});
export type SecretFile = z.infer<typeof SecretFile>;

/** Taking a credential back: the variable, or the file. */
export const Forget = z.union([z.object({ env: EnvName }), z.object({ file: z.string().min(1).max(1024) })]);
export type Forget = z.infer<typeof Forget>;

/** A terminal of herdr's, by its pane's id (w1:p2). */
export const PaneId = z.string().regex(/^w\d{1,6}:p\d{1,6}$/);

/** A credential typed once into a terminal, with Enter after it (a CLI waiting for a code). */
export const SecretTyped = z.object({ pane: PaneId, value: z.string().min(1).max(20_000) });
export type SecretTyped = z.infer<typeof SecretTyped>;

/**
 * A terminal: a websocket at `/terminal?cols=<n>&rows=<n>` that shows herdr's own interface (the terminals Amuse
 * and the user share). Binary messages are bytes both ways (what is typed, what the terminal shows); a text
 * message from the viewer is one of these.
 */
export const TERMINAL_PATH = "/terminal";
export const Cols = z.int().min(1).max(1000);
export const Rows = z.int().min(1).max(500);
export const TerminalMessage = z.object({ type: z.literal("resize"), cols: Cols, rows: Rows });
export type TerminalMessage = z.infer<typeof TerminalMessage>;
