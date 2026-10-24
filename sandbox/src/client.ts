/**
 * The client of the sandbox's control daemon, behind an interface so what
 * uses it (the tools, the server's reset) can be tested with a fake. The
 * daemon is not trusted: what it answers is checked against the schemas, a
 * body is read only up to a limit, and every request has a deadline. Whatever
 * goes wrong comes back as a SandboxError whose message is always the
 * client's own words; what the daemon said about it is kept apart, in
 * `detail`, to be shown only as untrusted text.
 */
import type { z } from "zod";
import {
  type AtRiskFolder,
  AtRiskFolders,
  DEFAULT_TIMEOUT,
  Failure,
  type Forget,
  HANDOFF_SECONDS,
  JOB_LIFETIME,
  type JobRef,
  JobState,
  JobStates,
  Nothing,
  Ran,
  type Run,
  type SecretEnv,
  type SecretFile,
  type SecretTyped,
  type Start,
  type StopJobs,
  TERMINAL_PATH,
} from "./protocol.ts";

/** A request the sandbox could not do, or could not be asked: why, in words of our own. */
export class SandboxError extends Error {
  /** what the daemon said about it, if it did: not to be trusted */
  readonly detail: string | undefined;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

export interface SandboxClient {
  /** Run a command to completion; `signal` ends it early (the command is stopped). */
  run(request: Run, signal?: AbortSignal): Promise<Ran>;
  /**
   * Run a command as a job of a chat: the answer comes when it ends, or after the hand-off wait (at once for a background one),
   * with it still `running`. `signal` ends it early while it is waited for (the command is stopped); once handed off it
   * goes on, until it ends or is stopped.
   */
  start(request: Start, signal?: AbortSignal): Promise<JobState>;
  /** A job of the chat as it stands now. */
  jobOutput(job: JobRef): Promise<JobState>;
  /** Stop a job of the chat, or every one of them; each answer is how the job stands once it has ended. */
  stopJobs(request: StopJobs): Promise<JobState[]>;
  /** Wait for a job of the chat to end (it ends at the latest at its lifetime), and say how it did. */
  waitJob(job: JobRef): Promise<JobState>;
  /** Stop everything and empty the home folder back to its skeleton; the workspace stays. */
  reset(): Promise<void>;
  /** Folders in the home folder, outside the workspace, that a reset would delete: what the user may want kept. */
  atRisk(): Promise<AtRiskFolder[]>;
  /** Type a credential into a terminal of herdr's, with Enter after it (a CLI waiting for a code). */
  typeSecret(secret: SecretTyped): Promise<void>;
  /** Keep a credential as an environment variable every command gets. */
  setEnv(secret: SecretEnv): Promise<void>;
  /** Keep a credential as a file of the user's in the home folder. */
  setFile(secret: SecretFile): Promise<void>;
  /** Take a credential back. */
  forget(what: Forget): Promise<void>;
}

/** How long a quick request may take (a reset is the slowest of them), and how long a command may take beyond its own timeout before the answer is given up on. */
const QUICK_MS = 120_000;
const MARGIN_MS = 30_000;
/** The most of an answer that is read. */
export const MAX_ANSWER = 1024 ** 2;

/** A response's body as text, read as it comes and given up on past `MAX_ANSWER`. */
async function readText(res: Response): Promise<string> {
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.length;
    if (size > MAX_ANSWER) {
      await reader.cancel().catch(() => {});
      throw new SandboxError("The sandbox's answer was too large to take.");
    }
    text += decoder.decode(value, { stream: true });
  }
}

export function sandboxClient(
  url: string,
  request: typeof fetch = fetch,
  { quick = QUICK_MS, margin = MARGIN_MS }: { quick?: number; margin?: number } = {},
): SandboxClient {
  /** `limit` ms at most, and sooner if `signal` says so. */
  const call = async <T>(method: "GET" | "POST", path: string, shape: z.ZodType<T>, limit: number, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const deadline = AbortSignal.timeout(limit);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let res: Response;
    let text: string;
    try {
      res = await request(new URL(path, url), {
        method,
        signal: stop,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      text = await readText(res);
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      if (signal?.aborted) throw error;
      throw new SandboxError(
        deadline.aborted ? "The sandbox took too long to answer." : "The sandbox cannot be reached just now: it may be starting, or stopped.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SandboxError(`The sandbox gave an answer that could not be read (${res.status}).`);
    }
    if (!res.ok) throw new SandboxError(`The sandbox could not do that (${res.status}).`, Failure.safeParse(parsed).data?.error.slice(0, 500));
    const answer = shape.safeParse(parsed);
    if (!answer.success) throw new SandboxError("The sandbox gave an answer that could not be understood.");
    return answer.data;
  };
  return {
    run: (run, signal) => call("POST", "/run", Ran, (run.timeout ?? DEFAULT_TIMEOUT) * 1000 + margin, run, signal),
    start: (job, signal) => call("POST", "/jobs", JobState, (job.background ? 0 : HANDOFF_SECONDS) * 1000 + margin, job, signal),
    jobOutput: (job) => call("POST", "/jobs/output", JobState, quick, job),
    stopJobs: async (request) => (await call("POST", "/jobs/stop", JobStates, quick, request)).jobs,
    waitJob: (job) => call("POST", "/jobs/wait", JobState, JOB_LIFETIME * 1000 + margin, job),
    reset: async () => void (await call("POST", "/reset", Nothing, quick)),
    atRisk: async () => (await call("GET", "/at-risk", AtRiskFolders, quick)).folders,
    typeSecret: async (secret) => void (await call("POST", "/secrets/type", Nothing, quick, secret)),
    setEnv: async (secret) => void (await call("POST", "/secrets/env", Nothing, quick, secret)),
    setFile: async (secret) => void (await call("POST", "/secrets/file", Nothing, quick, secret)),
    forget: async (what) => void (await call("POST", "/secrets/forget", Nothing, quick, what)),
  };
}

/** Where the daemon at `url` shows a terminal `cols` wide and `rows` high: a websocket (protocol.ts). */
export function terminalAt(url: string, cols: number, rows: number): string {
  const at = new URL(TERMINAL_PATH, url);
  at.protocol = at.protocol === "https:" ? "wss:" : "ws:";
  at.search = new URLSearchParams({ cols: String(cols), rows: String(rows) }).toString();
  return at.toString();
}
