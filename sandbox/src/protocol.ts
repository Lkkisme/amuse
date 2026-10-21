/**
 * What the sandbox's control daemon and its client say to each other: JSON
 * over HTTP, checked with these schemas on both sides. What the daemon says is
 * not taken for trusted (a process in the sandbox could stand in for it), so
 * what could carry words into the agent's context is held to a plain shape. A command is run to
 * completion (`POST /run`) or kept running as a service (`/services`, which
 * can be typed into); the daemon also keeps credentials the user gave for the
 * sandbox (`/secrets`) and empties the sandbox's home on request (`POST /reset`).
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

export const Start = z.object({ name: z.string().trim().min(1).max(60), command: z.string().min(1).max(100_000), cwd: z.string().max(4096).optional() });
export type Start = z.infer<typeof Start>;

export const Service = z.object({
  id: z.string().regex(/^s\d{1,9}$/),
  name: z.string().max(60),
  command: z.string(),
  cwd: z.string(),
  startedAt: z.string(),
  running: z.boolean(),
  exitCode: z.int().nullable(),
  signal: Signal.nullable(),
});
export type Service = z.infer<typeof Service>;

/** A service just started, with what it printed in its first moments (a crash on start shows there). */
export const Started = z.object({ service: Service, output: z.string() });
export type Started = z.infer<typeof Started>;

export const Services = z.object({ services: z.array(Service) });

/** A service's recent output: its last lines. */
export const Log = z.object({ service: Service, output: z.string(), cut: z.int().min(0) });
export type Log = z.infer<typeof Log>;

export const Stopped = z.object({ service: Service });

/** Why a request was not done, in the daemon's words (which the client does not pass on as its own). */
export const Failure = z.object({ error: z.string() });

/** An answer that says only that it is done. */
export const Nothing = z.object({});

/** A credential for commands here, as an environment variable every command gets. */
export const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/);
export const SecretEnv = z.object({ name: EnvName, value: z.string().min(1).max(20_000) });
export type SecretEnv = z.infer<typeof SecretEnv>;

/** A credential written to a file in the home folder (never the workspace, which the user and Amuse's own tools read). */
export const SecretFile = z.object({ path: z.string().min(1).max(1024), value: z.string().min(1).max(200_000) });
export type SecretFile = z.infer<typeof SecretFile>;

/** Taking a credential back: the variable, or the file. */
export const Forget = z.union([z.object({ env: EnvName }), z.object({ file: z.string().min(1).max(1024) })]);
export type Forget = z.infer<typeof Forget>;

/** A line typed into a running service (a CLI waiting for a code). */
export const Input = z.object({ text: z.string().max(20_000) });
