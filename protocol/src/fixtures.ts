/**
 * Typed samples covering every entity, event and call. The compiler proves
 * they are valid; other languages prove they decode and re-encode them
 * unchanged (scripts/kotlin-check).
 */
import type { Call, Envelope } from "./index.ts";

const at = "2026-10-20T08:24:00Z";

export const envelopes: Envelope[] = [
  { seq: 1, event: { kind: "upserted", index: 0, entity: { kind: "prompt", id: "p1", at, text: "Log in to the trip portal" } } },
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
      entity: { kind: "approval", id: "a1", at, action: "Send email", target: "restaurant@example.com", detail: "Table for 4", status: "pending" },
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
      entity: { kind: "browser", id: "b1", at, title: "Log in", url: "https://portal.example.edu/login", status: "paused", instructions: "Log in to the trip portal; stop at the dashboard", result: null, live: true },
    },
  },
  {
    seq: 9,
    event: {
      kind: "upserted",
      index: 5,
      entity: { kind: "browser", id: "b1", at, title: "Log in", url: "https://portal.example.edu/login", status: "stopped", instructions: "Log in to the trip portal; stop at the dashboard", result: null, live: false },
    },
  },
  { seq: 10, event: { kind: "activity", activity: { kind: "responding", label: null } } },
  { seq: 11, event: { kind: "activity", activity: null } },
];

export const calls: Call[] = [
  { method: "session.sync", params: { since: null } },
  { method: "session.sync", params: { since: 7 } },
  { method: "session.history", params: { before: 40, limit: 20 } },
  { method: "chat.send", params: { text: "hi" } },
  { method: "chat.stop", params: {} },
  { method: "approval.resolve", params: { id: "a1", resolution: "allow_once" } },
  { method: "connection.begin", params: { id: "c1" } },
  { method: "connection.dismiss", params: { id: "c1" } },
  { method: "browser.control", params: { id: "b1", action: "handBack" } },
  { method: "browser.fit", params: { id: "b1", width: 390, height: 560 } },
  { method: "task.stop", params: { id: "t1" } },
  { method: "apps.search", params: { query: "mail", cursor: null } },
  { method: "apps.accounts", params: {} },
  { method: "apps.connect", params: { app: "gmail" } },
  { method: "apps.disconnect", params: { account: "ca_1" } },
];
