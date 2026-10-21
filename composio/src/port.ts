/**
 * The connector port on Composio. `connect` returns the hosted link at once;
 * the connection is marked connected, and the agent woken with a note, the
 * moment Composio reports the new account active — right away when the user's browser comes back through
 * our callback (Composio redirects there after authorizing), otherwise by
 * polling. Either path only asks Composio; the callback merely says "look
 * now", so a forged one cannot connect anything. Gives up quietly after
 * `timeoutMs` (the card stays pending; the user can tap Connect again).
 */
import type { AgentIO, Ports, Timers } from "@amuse/core";
import type { Connection } from "@amuse/protocol";
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
  io: AgentIO;
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
    const { title, id } = watch.connection;
    // wake the agent: whatever needed the app can go on now (or it knows it will not)
    if (status === "active") {
      if (watch.io.act({ kind: "connected", id }).ok) watch.io.report(`[app connection] ${title} is connected now. If something was waiting on it, carry on with it; if not, there is nothing to say.`);
    } else watch.io.report(`[app connection] Connecting ${title} did not go through (the authorization failed or was cancelled).`);
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
    async connect(connection, io) {
      const key = randomKey();
      const { url, account } = await client.link(connection.provider, options.userId, options.callbackUrl?.(key));
      watching.set(key, { connection, account, io });
      poll(key, polls);
      return url;
    },
    returned: async (key) => (await check(key).catch(() => "pending")) === "active",
  };
}
