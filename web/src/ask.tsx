/**
 * "Ask Amuse" beside an error: it does not send anything. It puts a line in the composer and the error over it as a
 * quote (the same bar as a reply's), and the error's technical detail goes to the agent with the message, unseen.
 */
import { createContext, useContext } from "react";
import { rawOf, wordsOf } from "./shown.ts";

/** An error as the user reads it (`message`) and as the agent should (`detail`: code, feature, provider, time). */
export interface ErrorAbout {
  message: string;
  detail: string;
}

export const AskContext = createContext<(about: ErrorAbout) => void>(() => {});

/** The detail the agent gets with an error: what, where, and when. */
export const detailOf = (feature: string, provider: string, code: string): string =>
  `code: ${code}; feature: ${feature}; provider: ${provider}; time: ${new Date().toISOString()}`;

/** What an action that failed can say: the message the user reads, and where it went wrong and how to try again. */
export interface Failed {
  detail: string;
  retry?: () => void;
}

/** Show an action's failure as the one toast (it floats over Settings too). */
export const NotifyContext = createContext<(message: string, failed?: Failed) => void>(() => {});

/** What the agent is told of a failure: where it happened and what it said, as it came (not the user's words). */
export const failureDetail = (feature: string, error: unknown): string =>
  `feature: ${feature}; error: ${error instanceof Error ? error.name : "Error"}: ${rawOf(error)}; time: ${new Date().toISOString()}`;

/**
 * `fail(error, feature, retry?)`: an action failed, said as a toast with Ask Amuse (and Retry where there is one), in the
 * user's words; the agent gets `feature` and the error as it came (redacted by the server, like any error text).
 */
export function useFail(): (error: unknown, feature: string, retry?: () => void) => void {
  const notify = useContext(NotifyContext);
  return (error, feature, retry) => notify(wordsOf(error), { detail: failureDetail(feature, error), ...(retry ? { retry } : {}) });
}
