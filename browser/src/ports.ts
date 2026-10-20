/**
 * Browser runs on the pool without an agent: a run opens its page and is
 * complete once it has loaded; the user can still watch and take over.
 * Status changes go through the rules (a stopped run stays stopped).
 */
import type { Ports } from "@remuse/core";
import type { Pool } from "./pool.ts";

export function browserPorts(pool: Pool): Pick<Ports, "browse" | "browser"> {
  return {
    browse(browser, { act }) {
      pool.open(browser.id, browser.url).then(
        () => act({ kind: "browserStatus", id: browser.id, status: "completed" }),
        () => act({ kind: "browserStatus", id: browser.id, status: "failed" }),
      );
    },
    browser({ browser, action }, { act }) {
      switch (action) {
        case "take":
          return; // the live channel accepts input while the run is paused
        case "handBack":
          // the user may have logged in: keep it; there is no agent to resume, so the run is done
          void pool.save(browser.id).catch(() => {});
          return void act({ kind: "browserStatus", id: browser.id, status: "completed" });
        case "stop":
          return void pool.close(browser.id);
      }
    },
  };
}
