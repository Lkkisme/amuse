/**
 * The client of the sandbox's control daemon, behind an interface so what
 * uses it (the tools, the server's reset) can be tested with a fake. Whatever
 * goes wrong comes back as a SandboxError whose message says it in words.
 */
import type { z } from "zod";
import { Failure, Log, Nothing, Ran, type Run, type Service, Services, type Start, Started, Stopped } from "./protocol.ts";

/** A request the sandbox could not do, or could not be asked: why, in words. */
export class SandboxError extends Error {}

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
}

/** How long a quick request may take (a reset is the slowest of them). */
const QUICK_MS = 120_000;

export function sandboxClient(url: string, request: typeof fetch = fetch): SandboxClient {
  const call = async <T>(method: "GET" | "POST", path: string, shape: z.ZodType<T>, body?: unknown, signal?: AbortSignal): Promise<T> => {
    let res: Response;
    let text: string;
    try {
      res = await request(new URL(path, url), {
        method,
        signal: signal ?? AbortSignal.timeout(QUICK_MS),
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      text = (await res.text()).trim();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new SandboxError("The sandbox cannot be reached just now: it may be starting, or stopped.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SandboxError(`The sandbox gave an answer that could not be read (${res.status}).`);
    }
    if (!res.ok) throw new SandboxError(Failure.safeParse(parsed).data?.error ?? `The sandbox refused (${res.status}).`);
    const answer = shape.safeParse(parsed);
    if (!answer.success) throw new SandboxError("The sandbox gave an answer that could not be understood.");
    return answer.data;
  };
  const named = (service: string) => `/services/${encodeURIComponent(service)}`;
  return {
    run: (run, signal) => call("POST", "/run", Ran, run, signal),
    start: (start) => call("POST", "/services", Started, start),
    services: async () => (await call("GET", "/services", Services)).services,
    log: (service, lines) => call("GET", `${named(service)}/log${lines === undefined ? "" : `?lines=${lines}`}`, Log),
    stop: async (service) => (await call("POST", `${named(service)}/stop`, Stopped, {})).service,
    reset: async () => void (await call("POST", "/reset", Nothing)),
  };
}
