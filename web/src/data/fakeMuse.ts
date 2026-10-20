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

/**
 * Browser run states, as Muse shows them on the card and in the viewer header:
 * working (blue) -> waiting = needs your help (orange, "Action required")
 * -> completed (green). stopped is what Stop leaves behind.
 */
export type BrowserStatus = "working" | "waiting" | "completed" | "stopped";

export interface BrowserRun {
  id: string;
  /** task title, shown after the status on the card and as the viewer title */
  title: string;
  site: string;
  path: string;
  status: BrowserStatus;
  /** who drives this browser: agent, or user during takeover */
  control: "agent" | "user";
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
  /** active tab */
  browserId: string;
  /** browser runs whose tab the user closed; every other run in the chat is a tab */
  closedTabs: string[];
}

export type ActivityStatus = "idle" | "working" | "connected";

/**
 * Line under the Muse name on the avatar badge, e.g. "Reading entry" (globe),
 * "is responding" (list), "Opening page" / "Filling form" / "Re-observing
 * page" (tools). Refs 02-run-*, 03-form-*, 11-done.
 */
export interface AgentStatus {
  icon: "web" | "list" | "tool";
  text: string;
}

export interface DemoState {
  feed: FeedItem[];
  assistantThinking: boolean;
  /** scripted activity; null falls back to "is responding" while thinking/streaming */
  agentStatus: AgentStatus | null;
  /** task whose detail sheet is open */
  taskDetail: string | null;
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
    agentStatus: null,
    taskDetail: null,
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
        browser: { id: "b1", title: "Monterey Bay Aquarium exhibits", site: "mbayaq.org", path: "/exhibits", status: "completed", control: "agent", thumbnailHue: 200 },
      },
      { id: "m5", role: "user", text: "Also check the tide schedule, and log in to the trip portal for me", time: "8:28 AM" },
      {
        id: "c6",
        role: "card",
        kind: "browser",
        browser: { id: "b2", title: "Check the tide schedule", site: "tidesandcurrents.noaa.gov", path: "/stationhome", status: "working", control: "agent", thumbnailHue: 170 },
      },
      {
        id: "c7",
        role: "card",
        kind: "browser",
        browser: { id: "b3", title: "Log in to the trip portal", site: "portal.example.edu", path: "/login", status: "waiting", control: "agent", thumbnailHue: 30 },
      },
      {
        id: "m6",
        role: "agent",
        text: "The portal is asking for your login. The browser is waiting for you: take control, sign in, then tap **Done** and I'll pick it up from there.",
        time: "8:28 AM",
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

export const browserStatusMeta: Record<BrowserStatus, { label: string; color: string }> = {
  working: { label: "Working", color: "var(--fill-blue)" },
  waiting: { label: "Waiting for you", color: "var(--fill-orange)" },
  completed: { label: "Completed", color: "var(--fill-green)" },
  stopped: { label: "Stopped", color: "var(--icon-secondary)" },
};

export const levelMeta: Record<Level, string> = {
  allow: "Allow",
  ask: "Ask",
  deny: "Deny",
};

/* ---------- feed helpers ---------- */

interface CardPayloads {
  task: Task;
  approval: Approval;
  connreq: ConnectionRequest;
  browser: BrowserRun;
}

/** Return a new feed where the `kind` card whose payload id is `id` is replaced by `fn(payload)`. */
export function updateCard<K extends keyof CardPayloads>(
  feed: FeedItem[],
  kind: K,
  id: string,
  fn: (payload: CardPayloads[K]) => CardPayloads[K],
): FeedItem[] {
  return feed.map((item) => {
    if (item.role !== "card" || item.kind !== kind) return item;
    const payload = (item as unknown as Record<K, CardPayloads[K]>)[kind];
    return payload.id === id ? ({ ...item, [kind]: fn(payload) } as FeedItem) : item;
  });
}

export function findTask(feed: FeedItem[], id: string): Task | undefined {
  for (const item of feed) if (item.role === "card" && item.kind === "task" && item.task.id === id) return item.task;
  return undefined;
}

/** The browser run the floating task pill follows: newest waiting one, else newest working one. */
export function pillBrowser(feed: FeedItem[]): BrowserRun | undefined {
  const runs = feed.flatMap((i) => (i.role === "card" && i.kind === "browser" ? [i.browser] : [])).reverse();
  return runs.find((b) => b.status === "waiting") ?? runs.find((b) => b.status === "working");
}

export function findBrowser(feed: FeedItem[], id: string): BrowserRun | undefined {
  for (const item of feed) if (item.role === "card" && item.kind === "browser" && item.browser.id === id) return item.browser;
  return undefined;
}
