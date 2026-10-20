/**
 * Fake state for the remuse demo. Single in-memory store, no backend.
 * Screen inventory and interaction contract: docs/ui-spec.md.
 */

export type TaskStatus = "working" | "waiting_input" | "waiting_approval" | "completed" | "failed";

export interface TaskStep {
  label: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  form?: { field: string; label: string; value: string }[];
}

export interface Approval {
  id: string;
  verb: string;
  target: string;
  detail: string;
  status: "pending" | "approved" | "denied";
}

export interface ConnectionRequest {
  id: string;
  app: string;
  capability: string;
  status: "pending" | "explaining" | "connected" | "dismissed";
}

export interface BrowserRun {
  id: string;
  title: string;
  site: string;
  status: "working" | "completed" | "failed";
  thumbnailHue: number;
}

export type FeedItem =
  | { id: string; role: "user"; text: string; time: string }
  | { id: string; role: "agent"; text: string; time: string; streaming?: boolean }
  | { id: string; role: "card"; kind: "task"; task: Task }
  | { id: string; role: "card"; kind: "approval"; approval: Approval }
  | { id: string; role: "card"; kind: "connreq"; connreq: ConnectionRequest }
  | { id: string; role: "card"; kind: "browser"; browser: BrowserRun };

export type Level = "allow" | "ask" | "deny";

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

export interface ViewerState {
  browserId: string;
  /** agent = Muse is driving (offers Take control); user = takeover active */
  control: "agent" | "user";
}

export type ActivityStatus = "idle" | "working" | "connected";

export interface DemoState {
  feed: FeedItem[];
  assistantThinking: boolean;
  /** right activity panel: idle (closed) / working / connected */
  activityStatus: ActivityStatus;
  activityOpen: boolean;
  chatsOpen: boolean;
  settingsOpen: boolean;
  settingsSection: "general" | "connectors" | "permissions" | "secure-store";
  connectorDetail: string | null;
  viewer: ViewerState | null;
  /** id of the connection request currently showing its explainer modal */
  explainerFor: string | null;
  connectors: Connector[];
  websiteRules: WebsiteRule[];
  credentials: Credential[];
}

export function seedDemo(): DemoState {
  return {
    assistantThinking: false,
    activityStatus: "idle",
    activityOpen: false,
    chatsOpen: false,
    settingsOpen: false,
    settingsSection: "connectors",
    connectorDetail: null,
    viewer: null,
    explainerFor: null,
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
    feed: [
      { id: "m1", role: "user", text: "Check the school-trip email and research exhibits at the aquarium", time: "8:24 AM" },
      {
        id: "m2",
        role: "agent",
        text: "I found the trip email, opened it, and pulled together the exhibit options. Here's the plan I'm following:",
        time: "8:25 AM",
      },
      {
        id: "c1",
        role: "card",
        kind: "task",
        task: {
          id: "t1",
          title: "Aquarium trip research",
          status: "working",
          steps: [
            { label: "Open the trip email", done: true },
            { label: "List exhibit options", done: true },
            { label: "Check opening hours", done: false },
            { label: "Summarize for the reply", done: false },
          ],
        },
      },
      { id: "m3", role: "user", text: "Book the table for Friday", time: "8:27 AM" },
      {
        id: "c2",
        role: "card",
        kind: "approval",
        approval: {
          id: "a1",
          verb: "Send email",
          target: "restaurant@example.com",
          detail: "Reserve a table for 4, Friday 7pm. Draft ready for your review.",
          status: "pending",
        },
      },
      {
        id: "c5",
        role: "card",
        kind: "task",
        task: {
          id: "t2",
          title: "Reply to the trip coordinator",
          status: "waiting_input",
          steps: [
            { label: "Draft the reply", done: true },
            { label: "Confirm headcount", done: false },
          ],
          form: [
            { field: "headcount", label: "How many students and chaperones?", value: "" },
            { field: "deadline", label: "When do they need the answer?", value: "" },
          ],
        },
      },
      {
        id: "c3",
        role: "card",
        kind: "browser",
        browser: { id: "b1", title: "Monterey Bay Aquarium — exhibits", site: "mbayaq.org", status: "completed", thumbnailHue: 200 },
      },
      {
        id: "c4",
        role: "card",
        kind: "connreq",
        connreq: { id: "cr1", app: "Google Sheets", capability: "Read spreadsheets", status: "pending" },
      },
      {
        id: "m4",
        role: "agent",
        text: "While you review those, I can also track the tide-schedule page for changes — just say the word.",
        time: "8:27 AM",
      },
    ],
  };
}

export const taskStatusMeta: Record<TaskStatus, { label: string; color: string }> = {
  working: { label: "Working", color: "var(--fill-orange)" },
  waiting_input: { label: "Waiting for you", color: "var(--fill-orange)" },
  waiting_approval: { label: "Needs approval", color: "var(--fill-orange)" },
  completed: { label: "Completed", color: "var(--fill-green)" },
  failed: { label: "Failed", color: "var(--fill-red)" },
};

export const levelMeta: Record<Level, string> = {
  allow: "Allow",
  ask: "Ask",
  deny: "Deny",
};
