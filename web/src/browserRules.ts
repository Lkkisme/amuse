/** The browser's kinds of action as Settings › Permissions names them (see core/policy.ts for what they mean). */
import type {
  BrowserAction,
  Permission,
  SiteActions,
  SiteEntry,
} from "@amuse/protocol";

export const ACTIONS: {
  id: BrowserAction;
  name: string;
  short: string;
  about: string;
  options: Permission[];
}[] = [
  {
    id: "visit",
    name: "Visit websites",
    short: "Visit",
    about: "Open a page, or read one",
    options: ["allow", "ask", "deny"],
  },
  {
    id: "submit",
    name: "Submit forms",
    short: "Submit",
    about: "Steps that send, order, apply or post",
    options: ["allow", "ask", "deny"],
  },
  {
    id: "download",
    name: "Download files",
    short: "Download",
    about: "Keep what a page downloads in your files",
    options: ["allow", "ask", "deny"],
  },
  // asked about or denied, never allowed
  {
    id: "upload",
    name: "Upload files",
    short: "Upload",
    about: "Put a file of yours on a page",
    options: ["ask", "deny"],
  },
];

const permissionName: Record<Permission, string> = {
  allow: "Allow",
  ask: "Ask",
  deny: "Deny",
};

/** A website's exceptions in a line: "Never", or "Visit: Allow · Submit: Allow". */
export const summary = (rule: {
  never: boolean;
  actions: SiteActions;
}): string =>
  rule.never
    ? "Never"
    : ACTIONS.flatMap((a) => {
        const set = rule.actions[a.id];
        return set ? [`${a.short}: ${permissionName[set]}`] : [];
      }).join(" · ");

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
