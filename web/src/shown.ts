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
import { Dropped, CallFailed } from "@amuse/api/client";
import { Rejected } from "@amuse/core";
import { errors } from "@amuse/protocol";
import { activeT } from "./i18n/language.ts";
import type { Messages } from "./i18n/en.ts";

/** The rule a command was refused by (core's `Rejection`), from either side of the wire: thrown by the demo's host, or carried in an RPC error. */
export function rejectionOf(error: unknown): { kind: string; reason?: string } | null {
  if (error instanceof Rejected) return error.rejection;
  if (error instanceof CallFailed && error.code === errors.rejected.code) {
    const data = error.data;
    if (typeof data === "object" && data !== null && "kind" in data && typeof data.kind === "string") return data as { kind: string; reason?: string };
  }
  return null;
}

/**
 * The words for a failed call (`null`: nothing failed), in the active language. A refused command (invalid move, not found,
 * gone, …) is said in short words of the user's language, never the rule's own English; only `unsound` carries a sentence
 * of its own (what is wrong, in English), which reads as it is where there is no translation to give.
 */
export const wordsFor = (error: unknown, t: Messages): string | null => {
  if (error === null) return null;
  if (error instanceof Dropped) return t.common.serverUnreachable;
  const rejection = rejectionOf(error);
  if (rejection) {
    if (rejection.kind === "unsound") return t.rejected.unsound(rejection.reason ?? "");
    const words = t.rejected[rejection.kind as Exclude<keyof typeof t.rejected, "unsound">];
    return typeof words === "string" ? words : t.rejected.other;
  }
  return error instanceof Error ? error.message : String(error);
};

/** `wordsFor` for a failure that is certain, in the language on screen. */
export const wordsOf = (error: unknown): string => wordsFor(error, activeT()) ?? "";

/** What the agent is told of a failure: the error as it came, not the user's words (the rule's own English, with its kind). */
export const rawOf = (error: unknown): string => {
  const rejection = rejectionOf(error);
  const said = error instanceof Error ? error.message : String(error);
  return rejection ? `${said} (${JSON.stringify(rejection)})` : said;
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
