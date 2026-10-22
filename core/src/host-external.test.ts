import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chat, Prompt, Reply, Update } from "@amuse/protocol";
import { type Change, type Ports, createHost, memoryChats, memoryRules, noKeys, noLogins, noSandbox, noWorkspace } from "./index.ts";

const at = "2026-10-21T12:00:00.000Z";
const later = "2026-10-21T12:05:00.000Z";
const chat: Chat = { id: "p-1234", title: "Existing Paseo chat", at, updated: at };
const prompt: Prompt = { kind: "prompt", id: "external-user-1", at, text: "hello", timezone: "UTC", attachments: [] };
const reply: Reply = { kind: "reply", id: "external-reply-1", at, text: "hello", streaming: false, attachments: [] };

function fixture() {
  const calls: string[] = [];
  const ports: Ports = {
    prompt: () => void calls.push("prompt"),
    interrupt: () => void calls.push("interrupt"),
    title: async () => { calls.push("title"); return "generated"; },
    browse: () => void calls.push("browse"),
    job: () => void calls.push("job"),
    task: () => void calls.push("task"),
    schedule: () => void calls.push("schedule"),
    browser: () => void calls.push("browser"),
    approval: () => void calls.push("approval"),
    stopTask: () => void calls.push("stopTask"),
    fit: () => void calls.push("fit"),
    connect: async () => "https://connect.example/",
    apps: {
      search: async () => ({ apps: [], cursor: null }),
      accounts: async () => [],
      connect: async () => "https://connect.example/",
      disconnect: async () => {},
      permissions: async () => [],
      permit: async () => {},
    },
    rules: memoryRules(),
    keys: noKeys,
    logins: noLogins,
    sandbox: noSandbox,
    files: noWorkspace,
  };
  const store = memoryChats();
  const options = { store, clock: { now: () => later } };
  const host = createHost(ports, options);
  return { host, calls, ports, store, options };
}

test("external imports use the ordinary journal, ordered push and session synchronization without starting agents", async () => {
  const { host, calls, store } = fixture();
  const updates: Update[] = [];
  host.subscribe((update) => updates.push(update));
  host.external.ensureChat(chat);
  host.external.ingest(chat.id, [
    { kind: "upserted", entity: prompt },
    { kind: "upserted", entity: { ...reply, streaming: true } },
    { kind: "activity", activity: { kind: "responding", label: null } },
    { kind: "appended", id: reply.id, text: " world" },
    { kind: "upserted", entity: { ...reply, text: "hello world" } },
    { kind: "activity", activity: null },
  ]);
  const log = store.journal(chat.id).load();
  assert.deepEqual(log.map((envelope) => envelope.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(updates.filter((update) => update.kind === "event").map((update) => update.envelope), log);
  assert.deepEqual(await host.call("session.sync", { chat: chat.id, since: 2 }), { kind: "events", events: log.slice(2) });
  const state = host.external.state(chat.id);
  assert.deepEqual(state.entities, [prompt, { ...reply, text: "hello world" }]);
  assert.equal(state.activity, null);
  assert.deepEqual(calls, []);
});

test("external chat metadata and completed history survive reopening the same store", async () => {
  const { host, calls, ports, store, options } = fixture();
  host.external.ensureChat(chat);
  host.external.ingest(chat.id, [{ kind: "upserted", entity: prompt }, { kind: "upserted", entity: reply }]);
  const metadata = { ...chat, title: "Paseo title changed", updated: later };
  host.external.updateChat(metadata);
  const reopened = createHost(ports, options);
  assert.deepEqual(reopened.external.state(chat.id), host.external.state(chat.id));
  assert.deepEqual((await reopened.call("chats.list", {})).chats.find((entry) => entry.id === chat.id), metadata);
  assert.equal(store.journal(chat.id).load().length, 2);
  assert.deepEqual(calls, []);
});

test("ensuring existing chats keeps their names and imports suppress identical upserts and activities", async () => {
  const { host, store } = fixture();
  host.external.ensureChat(chat);
  host.external.ensureChat({ ...chat, title: "must not overwrite" });
  assert.equal((await host.call("chats.list", {})).chats.find((entry) => entry.id === chat.id)?.title, chat.title);
  const changes: Change[] = [{ kind: "upserted", entity: reply }, { kind: "activity", activity: { kind: "working", label: "Running tests" } }];
  host.external.ingest(chat.id, changes);
  host.external.ingest(chat.id, structuredClone(changes));
  assert.equal(store.journal(chat.id).load().length, 2);
  host.external.ingest(chat.id, [{ kind: "appended", id: reply.id, text: "!" }]);
  host.external.ingest(chat.id, [{ kind: "appended", id: reply.id, text: "!" }]);
  assert.equal(store.journal(chat.id).load().length, 4);
  const extended = host.external.state(chat.id).entities[0];
  assert.ok(extended?.kind === "reply");
  assert.equal(extended.text, "hello!!");
});

test("external state snapshots are detached and updating metadata leaves the feed untouched", () => {
  const { host, calls, store } = fixture();
  host.external.ensureChat(chat);
  host.external.ingest(chat.id, [{ kind: "upserted", entity: prompt }]);
  const snapshot = host.external.state(chat.id);
  const entity = snapshot.entities[0];
  assert.ok(entity?.kind === "prompt");
  entity.text = "modified outside";
  snapshot.entities.length = 0;
  snapshot.seq = 99;
  const before = host.external.state(chat.id);
  host.external.updateChat({ ...chat, title: "Renamed", updated: later });
  assert.deepEqual(host.external.state(chat.id), before);
  assert.deepEqual(before.entities, [prompt]);
  assert.equal(store.journal(chat.id).load().length, 1);
  assert.deepEqual(calls, []);
});

test("external import validates complete batches and rejects invalid ids, entity kind collisions and bad append targets", () => {
  const { host, store } = fixture();
  assert.throws(() => host.external.ensureChat({ ...chat, id: "../outside" }), /external chat id/);
  assert.throws(() => host.external.ensureChat({ ...chat, title: "x".repeat(81) }));
  host.external.ensureChat(chat);
  host.external.ingest(chat.id, [{ kind: "upserted", entity: prompt }]);
  assert.throws(() => host.external.ingest(chat.id, [
    { kind: "upserted", entity: reply },
    { kind: "upserted", entity: { ...reply, id: prompt.id } },
  ]), /changes kind/);
  assert.throws(() => host.external.ingest(chat.id, [{ kind: "appended", id: prompt.id, text: "wrong" }]), /requires a reply/);
  assert.throws(() => host.external.ingest(chat.id, [{ kind: "upserted", entity: { ...reply, id: "" } }]));
  assert.throws(() => host.external.ingest(chat.id, [{ kind: "activity", activity: { kind: "unknown", label: null } }] as unknown as Change[]));
  assert.equal(store.journal(chat.id).load().length, 1, "an invalid later change never leaves a partial imported batch");
  assert.deepEqual(host.external.state(chat.id).entities, [prompt]);
});

test("external entity ids cannot be reused by another chat", () => {
  const { host, store } = fixture();
  host.external.ensureChat(chat);
  host.external.ensureChat({ ...chat, id: "p-other" });
  host.external.ingest(chat.id, [{ kind: "upserted", entity: prompt }]);
  assert.throws(() => host.external.ingest("p-other", [{ kind: "upserted", entity: prompt }]), /belongs to another chat/);
  assert.equal(store.journal("p-other").load().length, 0);
});

test("external schedules are rejected before writing so imports cannot start the local schedule runner", () => {
  const { host, calls, store } = fixture();
  host.external.ensureChat(chat);
  assert.throws(() => host.external.ingest(chat.id, [
    { kind: "upserted", entity: prompt },
    { kind: "upserted", entity: {
      kind: "schedule", id: "external-schedule", at, title: "Owned by Paseo", instructions: "do work",
      when: { kind: "once", at: later }, status: "active", next: later, running: false, last: null, needs: null, preset: false, goal: null,
    } },
  ]), /external schedule imports are not supported/);
  assert.equal(store.journal(chat.id).load().length, 0);
  assert.deepEqual(calls, []);
});
