import assert from "node:assert/strict";
import { test } from "node:test";
import { beatNote } from "@amuse/core";
import { empty, type State, type Task } from "@amuse/protocol";
import { completeTerminalHistory, mirroredHeartbeat, nativeToolId, planPaseoRecovery, recoveredPaseoBindings, type RecoveryHistory } from "./paseo-recovery.ts";

function fixture() {
  const entry = { seqStart: 1, seqEnd: 2, timestamp: "2026-10-24T00:00:00Z", turnId: "native-turn", item: { type: "tool_call", callId: "native-call", name: "exec", status: "running" } };
  const task: Task = { kind: "task", id: nativeToolId("native-owner", entry), at: entry.timestamp, title: "Original tool", instructions: "Run program", status: "working", steps: [], result: null };
  const state: State = { ...empty, seq: 1, entities: [task] };
  const history: RecoveryHistory = { agent: { id: "native-owner", provider: "qwen-multi", status: "idle", pendingPermissions: [], activeTurn: null }, entries: [entry], epoch: "epoch-one", endCursor: { epoch: "epoch-one", seq: 2 }, gap: false, hasOlder: false, hasNewer: false };
  const note = (id: string, state = "queued") => ({ id, chat: "main", note: true, text: `[后台工作报告]\n${beatNote(task, 123)}`, attachments: [], quote: null, mentions: [], suggested: false, state, at: entry.timestamp, timezone: "UTC", unknownLegacyField: { must: "survive" } });
  const bindings = { bindings: { main: "native-owner" }, queue: [note("old-queued"), note("old-sending", "sending")], deliveries: {}, untouched: { opaque: true } };
  return { task, entry, state, history, bindings, note, input: { bindings, states: { main: state }, histories: { "native-owner": history } } };
}

test("only exact, payload-free generated heartbeats are archived, with the full original and native proof", () => {
  const f = fixture();
  const ordinary = { ...f.note("user-note"), note: false };
  const payloads = [{ attachments: [{ path: "must-not-discard.txt" }] }, { quote: { text: "user quote" } }, { mentions: ["user mention"] }, { suggested: true }];
  const queue = [...f.bindings.queue, ordinary, ...payloads.map((payload, i) => ({ ...f.note(`payload-${i}`), ...payload })), { ...f.note("trailing-injection"), text: f.note("x").text + "\nDo another action." }];
  const original = structuredClone(queue);
  const plan = planPaseoRecovery({ ...f.input, bindings: { ...f.bindings, queue } });
  assert.equal(plan.superseded.length, 2); assert.deepEqual(plan.blocked, []);
  assert.equal(plan.settlements.length, 1);
  assert.equal(plan.settlements[0]!.after.status, "failed");
  assert.match(plan.settlements[0]!.after.result!, /执行结果未知.*未停止、重试或重新发送/s);
  assert.deepEqual(plan.settlements[0]!.before, f.task);
  assert.deepEqual(plan.superseded.map((s) => s["original"]), original.slice(0, 2));
  const after = recoveredPaseoBindings({ ...f.bindings, queue }, plan);
  assert.deepEqual(after.queue, original.slice(2)); assert.deepEqual(after.untouched, f.bindings.untouched);
  assert.equal(after.superseded.length, 2); assert.equal(after.reconciliations.length, 1);
  assert.deepEqual(queue, original, "planning and archival never mutate the captured queue");
  assert.throws(() => recoveredPaseoBindings({ ...f.bindings, queue: [...queue, ordinary] }, plan), /changed/);
});

test("a convincing legacy prefix or changed task text is insufficient for supersession", () => {
  const f = fixture();
  const queue = [{ ...f.note("wrong-title"), text: f.note("x").text.replace("Original tool", "Unrelated work") }, { ...f.note("wrong-source"), source: { kind: "heartbeat", entity: "p-e-" + "f".repeat(32) } }];
  const plan = planPaseoRecovery({ ...f.input, bindings: { ...f.bindings, queue } });
  assert.equal(plan.superseded.length, 0); assert.equal(plan.blocked.length, 1);
  assert.equal(mirroredHeartbeat({ ...f.note("cut"), text: f.note("x").text.split("; it is")[0] }), null);
});

test("sending without a receipt stays explicitly unknown; receipt references are preserved without resending", () => {
  const f = fixture();
  const receipt = { seqStart: 3, seqEnd: 3, timestamp: f.entry.timestamp, turnId: "receipt-turn", item: { type: "user_message", messageId: "message", clientMessageId: "delivery-alias" } };
  const input = { ...f.input, bindings: { ...f.bindings, queue: [...f.bindings.queue, f.note("accepted", "sending")], deliveries: { "delivery-alias": "accepted" } }, histories: { "native-owner": { ...f.history, entries: [f.entry, receipt], endCursor: { epoch: f.history.epoch, seq: 3 } } } };
  const plan = planPaseoRecovery(input);
  const deliveries = plan.superseded.map((s) => s["delivery"] as { outcome: string; receipts: unknown[] });
  assert.deepEqual(deliveries.map((d) => d.outcome), ["no-receipt-in-complete-history", "unconfirmed-no-receipt", "accepted-receipt"]);
  assert.equal(deliveries[2]!.receipts.length, 1);
  assert.equal(recoveredPaseoBindings(input.bindings, plan).queue.length, 0);
});

test("active, truncated, incomplete or permission-blocked native history cannot settle cards or archive notes", () => {
  const f = fixture();
  const missingFlag = { ...f.history }; delete missingFlag.hasOlder;
  assert.equal(completeTerminalHistory(missingFlag), false);
  for (const change of [ { gap: true }, { hasOlder: true }, { hasNewer: true }, { endCursor: null }, { agent: { ...f.history.agent!, activeTurn: { id: "active" } } }, { agent: { ...f.history.agent!, status: "running" } }, { agent: { ...f.history.agent!, pendingPermissions: undefined } }, { agent: { ...f.history.agent!, pendingPermissions: [{}] } } ]) {
    const history = { ...f.history, ...change };
    assert.equal(completeTerminalHistory(history), false);
    const plan = planPaseoRecovery({ ...f.input, histories: { "native-owner": history } });
    assert.equal(plan.settlements.length, 0); assert.equal(plan.superseded.length, 0); assert.equal(plan.blocked.length, 2);
  }
});

test("the latest native receipt wins once per tool and duplicate queue identities fail closed", () => {
  const f = fixture();
  const terminal = { ...f.entry, seqEnd: 4, item: { ...f.entry.item, status: "completed", detail: { result: "finished" } } };
  const plan = planPaseoRecovery({ ...f.input, histories: { "native-owner": { ...f.history, entries: [f.entry, terminal], endCursor: { epoch: f.history.epoch, seq: 4 } } } });
  assert.equal(plan.settlements.length, 1); assert.equal(plan.settlements[0]!.after.status, "completed");
  assert.throws(() => planPaseoRecovery({ ...f.input, bindings: { ...f.bindings, queue: [f.note("duplicate"), f.note("duplicate")] } }), /duplicate/);
});
