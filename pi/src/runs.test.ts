import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentIO, RunMessage } from "@remuse/core";
import { type RunHandle, type Steerable, inbox } from "./runs.ts";

function run() {
  let listener: ((m: RunMessage) => void) | undefined;
  const io: AgentIO = {
    chat: "main",
    chats: () => [],
    readChat: () => null,
    emit: () => {},
    act: () => ({ ok: true, id: "x" }),
    decision: async () => ({ verdict: "denied", remember: false }),
    report: () => {},
    context: () => "",
    recall: () => "",
    time: () => ({ now: "2026-10-20T08:00:00Z", timezone: "UTC" }),
    answer: async () => ({ kind: "closed" }),
    listen: (_, fn) => {
      listener = fn;
      return () => (listener = undefined);
    },
  };
  const handle: RunHandle = { id: "b1", title: "Tides", noun: "browser task", io, stop: new AbortController().signal };
  return { handle, send: (m: RunMessage) => listener?.(m), listening: () => listener !== undefined };
}

test("Muse's message reaches a session mid-run before its next step; between prompts it waits for the next one", () => {
  const r = run();
  const steered: string[] = [];
  const session: Steerable = { isStreaming: true, steer: async (text) => void steered.push(text) };
  let current: Steerable | null = null;
  let stopped = 0;
  const mail = inbox(r.handle, () => current, () => stopped++);
  r.send({ kind: "instruction", text: "Also check tomorrow" });
  assert.deepEqual(steered, []);
  assert.match(mail.drain(), /Message from Muse[\s\S]*Also check tomorrow/);
  assert.equal(mail.drain(), "", "drained once");
  current = session;
  r.send({ kind: "instruction", text: "Skip the weekend" });
  assert.equal(steered.length, 1);
  assert.match(steered[0] ?? "", /Skip the weekend/);
  r.send({ kind: "stop" });
  assert.equal(stopped, 1);
  mail.close();
  assert.equal(r.listening(), false);
});
