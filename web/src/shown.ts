/**
 * What a page says when a call fails. A dropped connection has its own kind
 * (`Dropped`, api/src/client.ts) and is said in the app's words — never the
 * transport's own "disconnected" — and it does not stand once the page is back
 * and the connection is up again; a call the server refused keeps its words.
 */
import { Dropped } from "@amuse/api/client";
import type { Messages } from "./i18n/en.ts";

/** The words for a failed call (`null`: nothing failed), in the active language. */
export const wordsFor = (error: unknown, t: Messages): string | null => {
  if (error === null) return null;
  if (error instanceof Dropped) return t.common.serverUnreachable;
  return error instanceof Error ? error.message : String(error);
};

/** What still stands once the page is back and a call has gone through: a drop does not, anything else does. */
export const standsAfterReturn = (error: unknown): unknown => (error instanceof Dropped ? null : error);
