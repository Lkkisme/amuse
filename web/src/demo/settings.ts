/**
 * Settings data (connectors, website permissions, secure store). Not part of
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

export interface Capability {
  id: string;
  group: string;
  label: string;
  level: Level;
}

export interface Connector {
  id: string;
  name: string;
  blurb: string;
  category: string;
  connected: boolean;
  capabilities: Capability[];
}

export interface WebsiteRule {
  id: string;
  site: string;
  level: Level;
}

export interface SettingsData {
  connectors: Connector[];
  websiteRules: WebsiteRule[];
  credentials: Credential[];
}

export function seedSettings(): SettingsData {
  return {
    connectors: [
      {
        id: "gmail",
        name: "Gmail",
        blurb: "Read and send email",
        category: "Productivity",
        connected: true,
        capabilities: [
          { id: "gmail-r1", group: "Read permissions", label: "Access drafts", level: "allow" },
          { id: "gmail-r2", group: "Read permissions", label: "Access labels and filters", level: "allow" },
          { id: "gmail-r3", group: "Read permissions", label: "Read messages", level: "allow" },
          { id: "gmail-w1", group: "Write and delete", label: "Send email", level: "ask" },
          { id: "gmail-w2", group: "Write and delete", label: "Delete messages", level: "deny" },
        ],
      },
      {
        id: "gcal",
        name: "Google Calendar",
        blurb: "See and manage events",
        category: "Productivity",
        connected: true,
        capabilities: [
          { id: "gcal-r1", group: "Read permissions", label: "Read events", level: "allow" },
          { id: "gcal-w1", group: "Write and delete", label: "Create events", level: "ask" },
          { id: "gcal-w2", group: "Write and delete", label: "Delete events", level: "deny" },
        ],
      },
      {
        id: "gdrive",
        name: "Google Drive",
        blurb: "Find and share files",
        category: "Productivity",
        connected: false,
        capabilities: [
          { id: "gdrive-r1", group: "Read permissions", label: "Read files", level: "allow" },
          { id: "gdrive-w1", group: "Write and delete", label: "Create and edit files", level: "ask" },
          { id: "gdrive-w2", group: "Write and delete", label: "Delete files", level: "deny" },
        ],
      },
      {
        id: "sheets",
        name: "Google Sheets",
        blurb: "Read and edit spreadsheets",
        category: "Productivity",
        connected: false,
        capabilities: [
          { id: "sheets-r1", group: "Read permissions", label: "Read spreadsheets", level: "allow" },
          { id: "sheets-w1", group: "Write and delete", label: "Edit rows", level: "ask" },
        ],
      },
      {
        id: "github",
        name: "GitHub",
        blurb: "Browse repos and issues",
        category: "Developer tools",
        connected: false,
        capabilities: [
          { id: "gh-r1", group: "Read permissions", label: "Read repositories", level: "allow" },
          { id: "gh-w1", group: "Write and delete", label: "Open pull requests", level: "ask" },
        ],
      },
    ],
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
