/**
 * The hooks components use. A component that shows text calls useT, so it
 * re-renders when the language changes; code outside components reads the
 * active language directly (language.ts).
 */
import { useSyncExternalStore } from "react";
import {
  type Choice,
  currentChoice,
  activeT,
  setChoice,
  subscribeLanguage,
} from "./language.ts";
import type { Messages } from "./en.ts";

/** The messages in the active language. */
export function useT(): Messages {
  return useSyncExternalStore(subscribeLanguage, activeT);
}

/** The user's language choice, and a way to change it. */
export function useLanguageChoice(): [Choice, (choice: Choice) => void] {
  const choice = useSyncExternalStore(subscribeLanguage, currentChoice);
  return [choice, setChoice];
}
