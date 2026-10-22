/** The browser's kinds of action as Settings › Permissions names them (see core/policy.ts for what they mean). */
import type {
  BrowserAction,
  Permission,
  SiteActions,
  SiteEntry,
} from "@amuse/protocol";
import { type Language, activeLanguage, catalogOf } from "./i18n/language.ts";

/** Each kind of action, with the permissions it may be set to (names are in the catalog). */
export const ACTIONS: { id: BrowserAction; options: Permission[] }[] = [
  { id: "visit", options: ["allow", "ask", "deny"] },
  { id: "submit", options: ["allow", "ask", "deny"] },
  { id: "download", options: ["allow", "ask", "deny"] },
  // asked about or denied, never allowed
  { id: "upload", options: ["ask", "deny"] },
];

/** A website's exceptions in a line: "Never", or "Visit: Allow · Submit: Allow". */
export function summary(
  rule: { never: boolean; actions: SiteActions },
  language: Language = activeLanguage(),
): string {
  const t = catalogOf(language).permissions;
  return rule.never
    ? t.never
    : ACTIONS.flatMap((a) => {
        const set = rule.actions[a.id];
        return set ? [t.pair(t.actions[a.id].short, t.permission[set])] : [];
      }).join(" · ");
}

/**
 * What adding a website that may have exceptions already leaves: its Never stays (adding cannot lift it), and each action set now
 * replaces the one it had; the others stay as they were. Nothing set before is lost.
 */
export function mergedEntry(
  existing: SiteEntry | null,
  added: SiteEntry,
): SiteEntry {
  const never = (existing?.never ?? false) || added.never;
  const actions: SiteActions = never
    ? {}
    : { ...existing?.actions, ...added.actions };
  return { never, actions };
}
