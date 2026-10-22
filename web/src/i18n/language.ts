/**
 * The language the web app speaks: English or Simplified Chinese. The user's
 * pick is kept on this device (like the theme). "Follow the system" takes the
 * first of the browser's preferred languages that is Chinese or English.
 * Everything on screen reads the active language: its catalog (activeT), its
 * locale for dates and times (activeLocale), and the page's lang attribute.
 */
import { en, type Messages } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

export type Language = "en" | "zh-CN";

/** The user's choice: a language, or the system's. */
export type Choice = "system" | Language;
export const CHOICES: Choice[] = ["system", "en", "zh-CN"];

const KEY = "amuse.language";
const CATALOGS: Record<Language, Messages> = { en, "zh-CN": zhCN };
const LOCALES: Record<Language, string> = { en: "en-US", "zh-CN": "zh-CN" };

/** The messages of a language. */
export const catalogOf = (language: Language): Messages => CATALOGS[language];

/** The locale for dates and times in a language. */
export const localeOf = (language: Language): string => LOCALES[language];

/** The choice kept on this device; "Follow the system" when none is kept, or it is not one we know. */
export function parseChoice(kept: string | null): Choice {
  return CHOICES.find((c) => c === kept) ?? "system";
}

/**
 * The language a choice means. "Follow the system" takes the first of the
 * preferred languages that is Chinese (any Chinese variant, for now) or
 * English, and English when neither is there.
 */
export function resolveLanguage(
  choice: Choice,
  preferred: readonly string[],
): Language {
  if (choice !== "system") return choice;
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }
  return "en";
}

const listeners = new Set<() => void>();

type State = { choice: Choice; language: Language };
let state: State | null = null;

/** The choice and language on screen. Read from the device on first use, so importing this module has no effects. */
function current(): State {
  if (!state) {
    const choice = parseChoice(
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
    );
    state = {
      choice,
      language: resolveLanguage(
        choice,
        typeof navigator === "undefined" ? [] : navigator.languages,
      ),
    };
    if (typeof document !== "undefined")
      document.documentElement.lang = state.language;
  }
  return state;
}

/** Show the active language on the page: its lang attribute, and tell the listeners. */
function show(): void {
  if (typeof document !== "undefined")
    document.documentElement.lang = current().language;
  for (const listener of listeners) listener();
}

/** The user's choice, as kept on this device. */
export const currentChoice = (): Choice => current().choice;

/** The language on screen now. */
export const activeLanguage = (): Language => current().language;

/** The messages on screen now: the catalog of the active language. */
export const activeT = (): Messages => catalogOf(activeLanguage());

/** The locale for dates and times on screen now. */
export const activeLocale = (): string => localeOf(activeLanguage());

/** Keep the user's choice, and show its language at once. */
export function setChoice(choice: Choice): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, choice);
  state = {
    choice,
    language: resolveLanguage(
      choice,
      typeof navigator === "undefined" ? [] : navigator.languages,
    ),
  };
  show();
}

/** Hear about a change of language (for useSyncExternalStore). Returns the unsubscribe. */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
