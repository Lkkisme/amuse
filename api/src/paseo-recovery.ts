/** Owner-only, pure reconciliation of native tool mirrors and their obsolete heartbeats. */
import { createHash } from "node:crypto";
import { beatNote } from "@amuse/core";
import type { State, Task } from "@amuse/protocol";
import type { BridgeAgent, BridgeEntry } from "./paseo.ts";

export interface RecoveryHistory {
  agent: BridgeAgent | null;
  entries: BridgeEntry[];
  epoch: string;
  endCursor?: { epoch: string; seq: number } | null;
  gap?: boolean;
  hasOlder?: boolean;
  hasNewer?: boolean;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: unknown) => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function nativeToolId(agent: string, entry: BridgeEntry): string {
  const identity = text(entry.item["messageId"]) || text(entry.item["callId"]) || `tool_call:${entry.seqStart}`;
  return `p-e-${createHash("sha256").update(`${agent}:${identity}`).digest("hex").slice(0, 32)}`;
}

/** Old notes have no source field. Accept only our own heartbeat envelope and native mirror id. */
export function mirroredHeartbeat(item: Record<string, unknown>, task?: Task): string | null {
  if (item["note"] !== true || (item["suggested"] !== undefined && item["suggested"] !== false) || item["quote"] != null ||
    (item["attachments"] !== undefined && (!Array.isArray(item["attachments"]) || item["attachments"].length !== 0)) ||
    (item["mentions"] !== undefined && (!Array.isArray(item["mentions"]) || item["mentions"].length !== 0))) return null;
  const match = text(item["text"]).match(/^\[后台工作报告\]\n\[heartbeat\] Your task "[\s\S]*" \((p-e-[a-f0-9]{32})\) has been going (\d+) minutes; it is (?:queued|working|waiting)(?:, [\s\S]*)?\. Check on it if it seems stuck or slow \(message_run, or stop_run if it should stop\); tell the user only what they need to hear\. If all is well, call no_reply\.$/);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  const source = record(item["source"]);
  if (item["source"] !== undefined && (source["kind"] !== "heartbeat" || source["entity"] !== match[1])) return null;
  if (task && (task.id !== match[1] || text(item["text"]) !== `[后台工作报告]\n${beatNote(task, Number(match[2]))}`)) return null;
  return match[1]!;
}

export function completeTerminalHistory(history: RecoveryHistory): boolean {
  const agent = history.agent;
  return agent !== null && ["idle", "closed", "error"].includes(agent.status) && !agent["activeTurn"] &&
    Array.isArray(agent["pendingPermissions"]) && agent["pendingPermissions"].length === 0 &&
    history.epoch !== "" && history.endCursor?.epoch === history.epoch && Number.isSafeInteger(history.endCursor.seq) &&
    history.entries.every((entry) => entry.seqEnd <= history.endCursor!.seq) &&
    history.gap === false && history.hasOlder === false && history.hasNewer === false;
}

export function planPaseoRecovery(input: {
  bindings: Record<string, unknown>;
  states: Record<string, State>;
  histories: Record<string, RecoveryHistory>;
  at?: string;
}) {
  const { bindings, states, histories } = input;
  const at = input.at ?? new Date().toISOString();
  const queue = Array.isArray(bindings["queue"]) ? bindings["queue"] as Record<string, unknown>[] : [];
  const bound = record(bindings["bindings"]), deliveries = record(bindings["deliveries"]);
  const superseded: Record<string, unknown>[] = [];
  const blocked: { id: string; reason: string }[] = [];
  const settlements: { chat: string; before: Task; after: Task; proof: Record<string, unknown> }[] = [];
  const tools = new Map<string, { task: Task; proof: Record<string, unknown> }>();
  const queueIds = new Set<string>();
  for (const item of queue) {
    const id = text(item["id"]);
    if (!id || queueIds.has(id)) throw new Error("The Paseo queue has missing or duplicate identities; preserve it for manual review.");
    queueIds.add(id);
  }
  for (const [chat, state] of Object.entries(states)) {
    const agentId = text(bound[chat]), history = histories[agentId];
    if (!history || !completeTerminalHistory(history) || history.agent?.id !== agentId) continue;
    const historySha256 = digest(history.entries);
    const latestTools = new Map<string, BridgeEntry>();
    for (const entry of history.entries) if (entry.item["type"] === "tool_call") {
      const id = nativeToolId(agentId, entry);
      if ((latestTools.get(id)?.seqEnd ?? -1) <= entry.seqEnd) latestTools.set(id, entry);
    }
    for (const [id, entry] of latestTools) {
      const entity = state.entities.find((entity) => entity.kind === "task" && entity.id === id);
      if (!entity || entity.kind !== "task") continue;
      const proof = { agent: agentId, nativeStatus: history.agent.status, epoch: history.epoch, endCursor: history.endCursor ?? null,
        complete: true, tool: { id, seqStart: entry.seqStart, seqEnd: entry.seqEnd, turnId: entry.turnId ?? null, status: text(entry.item["status"]) },
        inspectedHistorySha256: historySha256, inspectedEntries: history.entries.length };
      tools.set(`${chat}:${id}`, { task: entity, proof });
      if (!["queued", "working", "waiting"].includes(entity.status)) continue;
      const nativeStatus = text(entry.item["status"]);
      const confirmed = ["completed", "failed", "canceled", "cancelled"].includes(nativeStatus);
      const status = nativeStatus === "completed" ? "completed" : ["canceled", "cancelled"].includes(nativeStatus) ? "stopped" : "failed";
      const result = confirmed ? JSON.stringify(entry.item["error"] ?? entry.item["detail"] ?? {}, null, 2) :
        `原生工具状态同步已结束，但缺少完成回执，执行结果未知。原生会话状态：${history.agent.status}；没有活动回合或待处理权限请求。未停止、重试或重新发送电脑任务。`;
      settlements.push({ chat, before: structuredClone(entity), after: { ...entity, status, result }, proof });
    }
  }
  for (const item of queue) {
    const entity = mirroredHeartbeat(item);
    if (!entity) continue;
    const id = text(item["id"]), chat = text(item["chat"]), tool = tools.get(`${chat}:${entity}`);
    if (!tool) { blocked.push({ id, reason: "No complete, terminal native history proves this tool mirror's origin." }); continue; }
    if (!mirroredHeartbeat(item, tool.task)) { blocked.push({ id, reason: "The full heartbeat does not exactly match the captured task and elapsed minutes." }); continue; }
    const agentId = text(bound[chat]), history = histories[agentId]!;
    const receipts = history.entries.filter((entry) => {
      const clientId = text(entry.item["clientMessageId"]);
      return entry.item["type"] === "user_message" && clientId !== "" && (clientId === id || deliveries[clientId] === id);
    }).map((entry) => ({ messageId: text(entry.item["messageId"]), clientMessageId: text(entry.item["clientMessageId"]),
      seqStart: entry.seqStart, seqEnd: entry.seqEnd, turnId: entry.turnId ?? null }));
    superseded.push({ at, reason: "obsolete-native-tool-heartbeat", original: structuredClone(item), originalSha256: digest(item),
      source: { chat, entity, ...tool.proof },
      delivery: { state: item["state"], outcome: receipts.length ? "accepted-receipt" : item["state"] === "sending" ? "unconfirmed-no-receipt" : "no-receipt-in-complete-history", receipts },
      explanation: "The native tool's owner is terminal. This redundant monitoring note is preserved here and will never be sent or retried; absence of a receipt does not assert that it was never accepted." });
  }
  return { at, queueSha256: digest(queue), superseded, settlements, blocked };
}

/** Returns replacement bytes' data; the owner must back up and atomically persist it while the API is stopped. */
export function recoveredPaseoBindings<T extends Record<string, unknown>>(bindings: T, plan: ReturnType<typeof planPaseoRecovery>) {
  const queue = Array.isArray(bindings["queue"]) ? bindings["queue"] : [];
  if (digest(queue) !== plan.queueSha256) throw new Error("Paseo queue changed after reconciliation. Take a new snapshot; nothing was applied.");
  const ids = new Set(plan.superseded.map((entry) => text(record(entry["original"])["id"])));
  return { ...bindings, queue: queue.filter((item) => !ids.has(text(record(item)["id"]))),
    superseded: [...(Array.isArray(bindings["superseded"]) ? bindings["superseded"] : []), ...plan.superseded],
    reconciliations: [...(Array.isArray(bindings["reconciliations"]) ? bindings["reconciliations"] : []),
      { at: plan.at, queueSha256: plan.queueSha256, settlements: plan.settlements }] };
}
