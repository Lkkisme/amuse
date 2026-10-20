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
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; text: string }
  | { id: string; role: "card"; kind: "task"; task: Task }
  | { id: string; role: "card"; kind: "approval"; approval: Approval }
  | { id: string; role: "card"; kind: "connreq"; connreq: ConnectionRequest }
  | { id: string; role: "card"; kind: "browser"; browser: BrowserRun };

export interface DemoState {
  feed: FeedItem[];
  assistantThinking: boolean;
  statusPill: string | null;
  drawerOpen: boolean;
  settingsOpen: boolean;
}

export function seedDemo(): DemoState {
  return {
    assistantThinking: false,
    statusPill: null,
    drawerOpen: false,
    settingsOpen: false,
    feed: [
      { id: "m1", role: "user", text: "Check the school-trip email and research exhibits at the aquarium" },
      {
        id: "m2",
        role: "agent",
        text: "I found the trip email, opened it, and pulled together the exhibit options. Here's the plan I'm following:",
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
      { id: "m3", role: "user", text: "Book the table for Friday" },
      {
        id: "c2",
        role: "card",
        kind: "approval",
        approval: {
          id: "a1",
          verb: "Send email",
          target: "restaurant@Example.com",
          detail: "Reserve a table for 4, Friday 7pm. Draft ready for your review.",
          status: "pending",
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
