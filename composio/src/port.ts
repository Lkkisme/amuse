/**
 * The connector port on Composio: `connect` returns the hosted link at once,
 * then watches the new account and marks the connection connected the moment
 * Composio reports it active. Gives up quietly after `timeoutMs` (the card
 * stays pending, and the user can tap Connect again).
 */
import type { Ports, Timers } from "@remuse/core";
import type { Composio } from "./client.ts";

export interface ConnectorOptions<H> {
  /** Composio user id all of this deployment's accounts belong to. */
  userId: string;
  timers: Timers<H>;
  pollMs?: number;
  timeoutMs?: number;
}

export function composioConnector<H>(client: Pick<Composio, "link" | "status">, options: ConnectorOptions<H>): Pick<Ports, "connect"> {
  const pollMs = options.pollMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  return {
    async connect(connection, emit) {
      const { url, account } = await client.link(connection.provider, options.userId);
      const poll = (left: number): void => {
        if (left <= 0) return;
        options.timers.set(pollMs, () => {
          client.status(account).then(
            (status) => {
              if (status === "active") emit({ kind: "upserted", entity: { ...connection, status: "connected" } });
              else if (status === "pending") poll(left - 1);
            },
            () => poll(left - 1), // transient errors: keep watching
          );
        });
      };
      poll(Math.ceil(timeoutMs / pollMs));
      return url;
    },
  };
}
