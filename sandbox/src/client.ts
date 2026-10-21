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
  DEFAULT_TIMEOUT,
  Failure,
  type Forget,
  Log,
  Nothing,
  Ran,
  type Run,
  type SecretEnv,
  type SecretFile,
  type Service,
  Services,
  type Start,
  Started,
  Stopped,
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
  /** Start a command that goes on running. */
  start(request: Start): Promise<Started>;
  services(): Promise<Service[]>;
  /** The last `lines` lines a service printed; `service` is its name or id. */
  log(service: string, lines?: number): Promise<Log>;
  stop(service: string): Promise<Service>;
  /** Stop everything and empty the home folder back to its skeleton; the workspace stays. */
  reset(): Promise<void>;
  /** Type a line into a running service (a CLI waiting for a code). */
  input(service: string, text: string): Promise<void>;
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
  const named = (service: string) => `/services/${encodeURIComponent(service)}`;
  return {
    run: (run, signal) => call("POST", "/run", Ran, (run.timeout ?? DEFAULT_TIMEOUT) * 1000 + margin, run, signal),
    start: (start) => call("POST", "/services", Started, quick, start),
    services: async () => (await call("GET", "/services", Services, quick)).services,
    log: (service, lines) => call("GET", `${named(service)}/log${lines === undefined ? "" : `?lines=${lines}`}`, Log, quick),
    stop: async (service) => (await call("POST", `${named(service)}/stop`, Stopped, quick, {})).service,
    reset: async () => void (await call("POST", "/reset", Nothing, quick)),
    input: async (service, text) => void (await call("POST", `${named(service)}/input`, Nothing, quick, { text })),
    setEnv: async (secret) => void (await call("POST", "/secrets/env", Nothing, quick, secret)),
    setFile: async (secret) => void (await call("POST", "/secrets/file", Nothing, quick, secret)),
    forget: async (what) => void (await call("POST", "/secrets/forget", Nothing, quick, what)),
  };
}
