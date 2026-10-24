import { observeRecovery, transientClose } from "@amuse/api/client";

/** A viewer may reconnect its transport; its remote page/process and inputs stay untouched. */
export function viewerRecovery(restart: () => void, pause: () => void = () => {}, enabled: () => boolean = () => true) {
  let disposed = false;
  let failed = false;
  let terminal = false;
  let live = false;
  let retry = 0;
  let lastMessage = Date.now();
  let messageVersion = 0;
  let lastRestart = -Infinity;
  let pausedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const active = () => !disposed && enabled() && recovery.active();
  const reconnect = () => {
    cancel();
    if (!active() || terminal) return;
    live = false;
    failed = false;
    lastRestart = Date.now();
    restart();
  };
  const schedule = (immediate = false) => {
    if (!active() || terminal || timer !== undefined) return;
    timer = setTimeout(reconnect, immediate ? 0 : Math.min(15_000, 500 * 2 ** Math.min(5, retry++)));
  };
  const wake = (network = false) => {
    if (!active() || terminal) return;
    const elapsed = pausedAt === null ? 0 : Date.now() - pausedAt;
    pausedAt = null;
    if (failed) { cancel(); schedule(true); return; }
    // Static pages/idle terminals need not send frames. Do not poll them or reconnect on every focus.
    if (!live || (!network && elapsed < 15_000) || Date.now() - lastRestart < 2_000) return;
    cancel();
    // Give a healthy stream a chance to prove it survived the network change.
    const received = messageVersion;
    timer = setTimeout(() => {
      timer = undefined;
      if (live && active() && !terminal && messageVersion === received) reconnect();
    }, Math.max(0, 5_000 - (Date.now() - lastMessage)));
  };
  const recovery = observeRecovery((reason) => {
    if (reason === "pause") { pausedAt ??= Date.now(); cancel(); pause(); }
    else wake(reason === "network");
  });
  return {
    message() { lastMessage = Date.now(); messageVersion++; },
    ready() { cancel(); failed = terminal = false; live = true; retry = 0; lastMessage = Date.now(); messageVersion++; },
    fail(retryable = true) { cancel(); live = false; failed = true; terminal = !retryable; schedule(); },
    manual() { cancel(); terminal = false; retry = 0; reconnect(); },
    wake() { wake(); },
    close() { disposed = true; cancel(); recovery.close(); },
  };
}

export const retryViewerClose = (code: number) => code !== 1000 && transientClose(code);
