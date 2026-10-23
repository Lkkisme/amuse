/**
 * What went wrong with Composio, as the user is told it: a rejection carries the words the app shows;
 * anything else is an internal error. "Could not be reached" is kept for a request that got no answer
 * or a 5xx; every other answer says what it was.
 */
import { Rejected } from "@amuse/core";
import { CannotLink, ComposioError, NoComposioKey } from "./client.ts";

export const composioSaid = (error: unknown): unknown => {
  const unsound = (reason: string) => new Rejected({ kind: "unsound", reason });
  if (error instanceof NoComposioKey) return unsound("Connections are not set up yet: add a Composio key in Settings › Connections.");
  if (error instanceof CannotLink) return unsound(cannotLink(error));
  if (!(error instanceof ComposioError)) return error;
  if (error.status === 401 || error.status === 403) return unsound("Composio did not accept the key: test or replace it in Settings › Connections.");
  if (error.status === 404) return unsound("Composio has no such app or setting for it (404). It may have been renamed or removed: search for the app again.");
  if (error.status === 429) return unsound("Composio is limiting requests just now (429). Try again in a minute.");
  if (error.status !== null && error.status < 500) return unsound(`Composio turned the request down (${error.status}). That is not a connection problem: Amuse's request does not suit what Composio expects for this app.`);
  if (error.network || error.status !== null) return unsound(`Composio could not be reached just now${error.status ? ` (${error.status})` : ""}. Try again in a moment.`);
  return unsound("Composio answered in a way Amuse does not understand: its service may have changed. Update Amuse, or try again later.");
};
/** What a toolkit that cannot be connected by a link is told as. */
const cannotLink = ({ why, app, label }: CannotLink): string => {
  switch (why) {
    case "key":
      return `${app} needs your own ${label ?? "key"}: enter it to connect.`;
    case "rejected":
      return `${app} did not accept that ${label ?? "key"}: check it and try again.`;
    case "managed":
      return `${app} needs no key: connect it with its link.`;
    case "unsupported":
      return `${app} needs credentials of your own that Amuse cannot set up yet, so it cannot be connected here.`;
  }
};
