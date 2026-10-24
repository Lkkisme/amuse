/**
 * What a page says when a call fails, and where it says it. A dropped connection
 * has its own kind (`Dropped`, api/src/client.ts) and is said in the app's words —
 * never the transport's own "disconnected" — and it does not stand once the page is
 * back and the connection is up again; a call the server refused keeps its words.
 *
 * Settings › Connections keeps two failures apart: the list's own (a search, the
 * accounts), and the one about the app whose page is open (how it connects, a
 * connection it refused). The second never shows on the list, and goes with the
 * page when the user leaves it.
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

/** What Connections shows when something fails: the list's, and the open app's, kept apart. */
export interface Failures {
  list: unknown;
  page: unknown;
}
export const noFailures: Failures = { list: null, page: null };

/** A call that failed, where it belongs: the list's, or the open app's (which the list never shows). */
export const failedAt = (failures: Failures, place: "list" | "page", error: unknown): Failures => ({ ...failures, [place]: error });

/** The open app is gone (the user left the page, or opened another): what failed about it goes with it. */
export const pageLeft = (failures: Failures): Failures => ({ ...failures, page: null });

/** A call that went through: a failure that was the connection dropping does not stand, either place. */
export const wentThrough = (failures: Failures): Failures => ({ list: standsAfterReturn(failures.list), page: standsAfterReturn(failures.page) });
