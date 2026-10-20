/**
 * Browser runs on the pool. Until the browser agent lands, a run opens its
 * page and is complete once the page has loaded; the user can still watch
 * it and take control. Failures to load mark the run failed.
 */
import type { Ports } from "@remuse/core";
import type { Pool } from "./pool.ts";

export function browserPorts(pool: Pool): Pick<Ports, "browse" | "browser"> {
  return {
    browse(browser, { emit }) {
      pool.open(browser.id, browser.url).then(
        () => emit({ kind: "upserted", entity: { ...browser, status: "completed" } }),
        () => emit({ kind: "upserted", entity: { ...browser, status: "failed" } }),
      );
    },
    browser({ browser, action }, emit) {
      switch (action) {
        case "take":
          return; // the live channel accepts input while the run is paused
        case "handBack":
          // the user may have logged in: keep it; no agent to resume, so the run is done
          void pool.save(browser.id).catch(() => {});
          return emit({ kind: "upserted", entity: { ...browser, status: "completed" } });
        case "stop":
          void pool.close(browser.id);
          return;
      }
    },
  };
}
