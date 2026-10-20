/**
 * Typed samples covering every entity, event and call. The compiler proves
 * they are valid; other languages prove they decode and re-encode them
 * unchanged (scripts/kotlin-check).
 */
import type { Call, Envelope } from "./index.ts";

const at = "2026-10-20T08:24:00Z";

export const envelopes: Envelope[] = [
  { seq: 1, event: { kind: "upserted", index: 0, entity: { kind: "prompt", id: "p1", at, text: "Log in to the trip portal", timezone: "Asia/Shanghai" } } },
  { seq: 2, event: { kind: "upserted", index: 1, entity: { kind: "reply", id: "r1", at, text: "On it", streaming: true } } },
  { seq: 3, event: { kind: "appended", id: "r1", text: "." } },
  { seq: 4, event: { kind: "activity", activity: { kind: "working", label: "Opening page" } } },
  {
    seq: 5,
    event: {
      kind: "upserted",
      index: 2,
      entity: {
        kind: "task",
        id: "t1",
        at,
        title: "Reply to the trip coordinator",
        steps: [{ label: "Draft the reply", done: true }],
        status: "waiting",
      },
    },
  },
  {
    seq: 6,
    event: {
      kind: "upserted",
      index: 3,
      entity: { kind: "approval", id: "a1", at, action: "Send email", target: "restaurant@example.com", detail: "Table for 4", remember: true, status: "pending", expires: "2026-10-20T08:54:00Z" },
    },
  },
  {
    seq: 7,
    event: { kind: "upserted", index: 4, entity: { kind: "connection", id: "c1", at, provider: "googlesheets", title: "Google Sheets", status: "pending" } },
  },
  {
    seq: 8,
    event: {
      kind: "upserted",
      index: 5,
      entity: { kind: "browser", id: "b1", at, title: "Log in", url: "https://portal.example.edu/login", status: "paused", instructions: "Log in to the trip portal; stop at the dashboard", result: null, step: null, live: true },
    },
  },
  {
    seq: 9,
    event: {
      kind: "upserted",
      index: 5,
      entity: { kind: "browser", id: "b1", at, title: "Log in", url: "https://portal.example.edu/login", status: "stopped", instructions: "Log in to the trip portal; stop at the dashboard", result: null, step: null, live: false },
    },
  },
  {
    seq: 10,
    event: {
      kind: "upserted",
      index: 6,
      entity: {
        kind: "schedule",
        id: "s1",
        at,
        title: "Morning briefing",
        instructions: "At 8, sum up today's calendar and unread mail; report only if there is something",
        when: { kind: "repeat", cron: "0 8 * * *", timezone: "Asia/Shanghai" },
        status: "active",
        next: "2026-10-21T00:00:00Z",
        running: false,
        last: { at: "2026-10-20T00:00:00Z", outcome: "quiet", summary: "Nothing new" },
      },
    },
  },
  {
    seq: 11,
    event: {
      kind: "upserted",
      index: 7,
      entity: { kind: "schedule", id: "s2", at, title: "Call the dentist", instructions: "Remind the user to call the dentist", when: { kind: "once", at: "2026-10-21T01:00:00Z" }, status: "done", next: null, running: false, last: null },
    },
  },
  { seq: 12, event: { kind: "activity", activity: { kind: "responding", label: null } } },
  { seq: 13, event: { kind: "activity", activity: null } },
];

export const calls: Call[] = [
  { method: "session.sync", params: { since: null } },
  { method: "session.sync", params: { since: 7 } },
  { method: "session.history", params: { before: 40, limit: 20 } },
  { method: "chat.send", params: { text: "hi", timezone: "Asia/Shanghai" } },
  { method: "chat.stop", params: {} },
  { method: "approval.resolve", params: { id: "a1", resolution: "allow_once" } },
  { method: "connection.begin", params: { id: "c1" } },
  { method: "connection.dismiss", params: { id: "c1" } },
  { method: "browser.control", params: { id: "b1", action: "handBack" } },
  { method: "browser.fit", params: { id: "b1", width: 390, height: 560 } },
  { method: "task.stop", params: { id: "t1" } },
  { method: "schedules.list", params: {} },
  { method: "schedule.control", params: { id: "s1", action: "pause" } },
  { method: "apps.search", params: { query: "mail", cursor: null } },
  { method: "apps.accounts", params: {} },
  { method: "apps.connect", params: { app: "gmail" } },
  { method: "apps.disconnect", params: { account: "ca_1" } },
  { method: "apps.permissions", params: { app: "gmail" } },
  { method: "apps.permit", params: { app: "gmail", kind: "write", permission: "ask" } },
  { method: "sites.rules", params: {} },
  { method: "sites.permit", params: { site: "bank.com", permission: "deny" } },
];
