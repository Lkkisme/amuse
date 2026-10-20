/**
 * The connector port on Composio. `connect` returns the hosted link at once;
 * the connection is marked connected the moment Composio reports the new
 * account active — right away when the user's browser comes back through
 * our callback (Composio redirects there after authorizing), otherwise by
 * polling. Either path only asks Composio; the callback merely says "look
 * now", so a forged one cannot connect anything. Gives up quietly after
 * `timeoutMs` (the card stays pending; the user can tap Connect again).
 */
import type { Emit, Ports, Timers } from "@remuse/core";
import type { Connection } from "@remuse/protocol";
import type { Composio } from "./client.ts";

export interface ConnectorOptions<H> {
  /** Composio user id all of this deployment's accounts belong to. */
  userId: string;
  timers: Timers<H>;
  /** Where Composio sends the user's browser afterwards, given a one-time key; no callback when absent. */
  callbackUrl?: (key: string) => string;
  pollMs?: number;
  timeoutMs?: number;
}

export interface Connector extends Pick<Ports, "connect"> {
  /** The user's browser came back with `key`: check now. True when that connected it. */
  returned(key: string): Promise<boolean>;
}

interface Watch {
  connection: Connection;
  account: string;
  emit: Emit;
}

const randomKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function composioConnector<H>(client: Pick<Composio, "link" | "status">, options: ConnectorOptions<H>): Connector {
  const pollMs = options.pollMs ?? 2000;
  const polls = Math.ceil((options.timeoutMs ?? 10 * 60_000) / pollMs);
  /** Connections waiting for their account, by one-time key; removed once settled. */
  const watching = new Map<string, Watch>();

  /** Ask Composio once; settle the watch when the account is active or failed. */
  const check = async (key: string): Promise<"active" | "pending" | "done"> => {
    const watch = watching.get(key);
    if (!watch) return "done";
    const status = await client.status(watch.account);
    if (status === "pending") return "pending";
    if (!watching.delete(key)) return "done"; // a concurrent check settled it first
    if (status === "active") watch.emit({ kind: "upserted", entity: { ...watch.connection, status: "connected" } });
    return status === "active" ? "active" : "done";
  };

  const poll = (key: string, left: number): void => {
    if (left <= 0) return void watching.delete(key);
    options.timers.set(pollMs, () => {
      check(key).then(
        (result) => (result === "pending" ? poll(key, left - 1) : undefined),
        () => poll(key, left - 1), // transient errors: keep watching
      );
    });
  };

  return {
    async connect(connection, emit) {
      const key = randomKey();
      const { url, account } = await client.link(connection.provider, options.userId, options.callbackUrl?.(key));
      watching.set(key, { connection, account, emit });
      poll(key, polls);
      return url;
    },
    returned: async (key) => (await check(key).catch(() => "pending")) === "active",
  };
}
