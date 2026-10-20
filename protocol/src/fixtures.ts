/**
 * Typed samples covering every entity, event and call. The compiler proves
 * they are valid; other languages prove they decode and re-encode them
 * unchanged (scripts/kotlin-check).
 */
import type { Call, Envelope } from "./index.ts";

const at = "2026-10-20T08:24:00Z";

export const envelopes: Envelope[] = [
  { seq: 1, event: { kind: "upserted", entity: { kind: "prompt", id: "p1", at, text: "Log in to the trip portal" } } },
  { seq: 2, event: { kind: "upserted", entity: { kind: "reply", id: "r1", at, text: "On it", streaming: true } } },
  { seq: 3, event: { kind: "appended", id: "r1", text: "." } },
  { seq: 4, event: { kind: "activity", activity: { kind: "operating", label: "Opening page" } } },
  {
    seq: 5,
    event: {
      kind: "upserted",
      entity: {
        kind: "task",
        id: "t1",
        at,
        title: "Reply to the trip coordinator",
        steps: [{ label: "Draft the reply", done: true }],
        questions: [{ id: "q1", label: "How many students?", answer: null }],
        status: "waiting",
      },
    },
  },
  {
    seq: 6,
    event: {
      kind: "upserted",
      entity: { kind: "approval", id: "a1", at, action: "Send email", target: "restaurant@example.com", detail: "Table for 4", decision: "pending" },
    },
  },
  {
    seq: 7,
    event: { kind: "upserted", entity: { kind: "connection", id: "c1", at, app: "Google Sheets", capability: "Read spreadsheets", status: "pending" } },
  },
  {
    seq: 8,
    event: {
      kind: "upserted",
      entity: { kind: "browser", id: "b1", at, title: "Log in", url: "https://portal.example.edu/login", state: { kind: "waiting", control: "user" } },
    },
  },
  {
    seq: 9,
    event: {
      kind: "upserted",
      entity: { kind: "browser", id: "b1", at, title: "Log in", url: "https://portal.example.edu/login", state: { kind: "stopped" } },
    },
  },
  { seq: 10, event: { kind: "activity", activity: null } },
];

export const calls: Call[] = [
  { method: "session.sync", params: { since: null } },
  { method: "session.sync", params: { since: 7 } },
  { method: "chat.send", params: { text: "hi" } },
  { method: "chat.stop", params: {} },
  { method: "approval.decide", params: { id: "a1", decision: "approve" } },
  { method: "task.answer", params: { id: "t1", answers: [{ question: "q1", answer: "24" }] } },
  { method: "connection.begin", params: { id: "c1" } },
  { method: "connection.dismiss", params: { id: "c1" } },
  { method: "browser.control", params: { id: "b1", action: "handBack" } },
];
