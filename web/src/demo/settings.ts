/**
 * Settings data (website permissions, secure store). Not part of
 * the protocol yet, so it lives here as local demo state.
 */

export const LEVELS = ["allow", "ask", "deny"] as const;
export type Level = (typeof LEVELS)[number];

export function parseLevel(value: string): Level | undefined {
  return LEVELS.find((l) => l === value);
}

export interface Credential {
  id: string;
  domain: string;
  username: string;
}

export interface WebsiteRule {
  id: string;
  site: string;
  level: Level;
}

export interface SettingsData {
  websiteRules: WebsiteRule[];
  credentials: Credential[];
}

export function seedSettings(): SettingsData {
  return {
    websiteRules: [
      { id: "w1", site: "mbayaq.org", level: "allow" },
      { id: "w2", site: "news.ycombinator.com", level: "ask" },
      { id: "w3", site: "opentable.com", level: "deny" },
    ],
    credentials: [{ id: "cred1", domain: "ucsd.edu", username: "student portal" }],
  };
}

export const levelMeta: Record<Level, string> = {
  allow: "Allow",
  ask: "Ask",
  deny: "Deny",
};
