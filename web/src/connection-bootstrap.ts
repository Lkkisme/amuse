import { observeRecovery } from "@amuse/api/client";

type Observe = typeof observeRecovery;

/** A temporary network failure is not evidence that the owner's session was revoked. */
export async function waitForUnlock(
  request: (signal: AbortSignal) => Promise<Response> = (signal) => fetch("/unlock", { signal, cache: "no-store" }),
  observe: Observe = observeRecovery,
  backoff: readonly number[] = [500, 1_000, 2_000, 5_000, 10_000],
): Promise<Response> {
  let abort: AbortController | null = null;
  let wake: (() => void) | null = null;
  let urgent = false;
  const recovery = observe((reason) => {
    urgent = reason !== "pause";
    abort?.abort();
    wake?.();
  });
  const wait = (ms: number) => new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => { clearTimeout(timer); if (wake === done) wake = null; resolve(); };
    wake = done;
    if (recovery.active()) timer = setTimeout(done, urgent ? 0 : ms);
  });
  let failures = 0;
  try {
    while (true) {
      while (!recovery.active()) await wait(0);
      urgent = false;
      const current = new AbortController();
      abort = current;
      const timer = setTimeout(() => current.abort(), 10_000);
      let response: Response | null = null;
      try { response = await request(current.signal); }
      catch { /* DNS, radio handover and suspended sockets are retried after recovery. */ }
      finally { clearTimeout(timer); if (abort === current) abort = null; }
      // A real authentication/policy response is terminal. Never retry credentials or bypass it.
      if (response && response.status < 500 && response.status !== 429) return response;
      const delay = backoff[Math.min(failures++, Math.max(0, backoff.length - 1))] ?? 10_000;
      await wait(delay);
    }
  } finally {
    abort?.abort();
    recovery.close();
  }
}
