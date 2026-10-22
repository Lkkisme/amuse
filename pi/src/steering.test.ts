import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentIO, Turn } from "@amuse/core";
import { type TranscriptContext, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { type AgentSession, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { chat } from "./scripted-chat.ts";

/** What the user has said to the model so far, message by message. */
const userTexts = (context: TranscriptContext): string[] =>
  context.messages.flatMap((m) => (m.role === "user" ? [typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("")] : []));

const message = (text: string): Turn => ({ kind: "message", text, attachments: [] });

/** A tool that holds the turn where it is (a long command) until the test lets it go. */
function slow() {
  let release: () => void = () => {};
  let begun: () => void = () => {};
  const running = new Promise<void>((resolve) => (begun = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  const tool = defineTool({
    name: "wait",
    label: "Wait",
    description: "A long command",
    parameters: Type.Object({}),
    async execute() {
      begun();
      await held;
      return { content: [{ type: "text", text: "finished" }], details: null };
    },
  });
  return { tool, running, release };
}

/** The user sends while the agent is partway through: it is in the chat first, then reaches the agent. */
const interject = (conversation: string[], agent: { prompt(turn: Turn, io: AgentIO): void }, io: AgentIO, text: string) => {
  conversation.push(`[08:01] User: ${text}`);
  agent.prompt(message(text), io);
};

test("a message sent while a turn is under way reaches the model mid-turn, and the turn answers it: one run, no second", async () => {
  const { tool, running, release } = slow();
  const seen: string[][] = [];
  const { agent, io, faux, conversation, replies, until } = await chat(
    [
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      (context) => {
        seen.push(userTexts(context));
        return fauxAssistantMessage("Done, and tomorrow too.");
      },
    ],
    { tools: [tool] },
  );
  agent.prompt(message("check today"), io);
  await running;
  interject(conversation, agent, io, "also check tomorrow");
  release();
  await until(1);
  assert.deepEqual(replies(), ["Done, and tomorrow too."]);
  assert.equal(faux.state.callCount, 2);
  const [texts] = seen;
  assert.equal(texts?.length, 2, "the brief, then the new message, once");
  assert.match(texts?.[0] ?? "", /User: hello/);
  assert.match(texts?.[1] ?? "", /also check tomorrow/);
});

test("a message that arrives as the model finishes is still read, once", async () => {
  const seen: string[][] = [];
  let sent = false;
  const sender: { send?: () => void } = {};
  const { agent, io, faux, conversation, replies, until } = await chat(
    [
      fauxAssistantMessage("First answer."),
      (context) => {
        seen.push(userTexts(context));
        return fauxAssistantMessage("Second answer.");
      },
    ],
    {
      opened: (session) => {
        // the loop has made its last look for new messages when it ends
        session.subscribe((event) => {
          if (event.type === "agent_end" && !sent) {
            sent = true;
            sender.send?.();
          }
        });
      },
    },
  );
  sender.send = () => interject(conversation, agent, io, "one more thing");
  agent.prompt(message("hello"), io);
  await until(1);
  assert.deepEqual(replies(), ["First answer.", "Second answer."]);
  assert.equal(faux.state.callCount, 2);
  assert.equal(seen[0]?.filter((t) => t.includes("one more thing")).length, 1);
});

const undelivered: { how: string; steer: AgentSession["steer"] }[] = [
  { how: "cannot be given to the model", steer: () => Promise.reject(new Error("the session is closed")) },
  { how: "is taken but the turn ends without reading it", steer: async () => "queued" },
];

for (const { how, steer } of undelivered) {
  test(`a message that ${how} becomes a turn of its own, after the one under way`, async () => {
    const { tool, running, release } = slow();
    const briefs: string[] = [];
    const { agent, io, faux, conversation, replies, until } = await chat(
      [
        fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("First answer."),
        (context) => {
          briefs.push(userTexts(context).join("\n"));
          return fauxAssistantMessage("Second answer.");
        },
      ],
      {
        tools: [tool],
        opened: (session: AgentSession) => {
          session.steer = steer;
        },
      },
    );
    agent.prompt(message("check today"), io);
    await running;
    interject(conversation, agent, io, "also check tomorrow");
    release();
    await until(2);
    assert.deepEqual(replies(), ["First answer.", "Second answer."]);
    assert.equal(faux.state.callCount, 3);
    assert.match(briefs[0] ?? "", /User: also check tomorrow/, "the new turn is given the chat with the message in it");
  });
}

test("a note from background work is not steered: it waits for the turn", async () => {
  const { tool, running, release } = slow();
  const seen: string[][] = [];
  const { agent, io, replies, until } = await chat(
    [
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      (context) => {
        seen.push(userTexts(context));
        return fauxAssistantMessage("First answer.");
      },
      fauxAssistantMessage(fauxToolCall("no_reply", {}), { stopReason: "toolUse" }),
    ],
    { tools: [tool] },
  );
  agent.prompt(message("check today"), io);
  await running;
  agent.prompt({ kind: "note", text: "[task t-1 completed] done" }, io);
  release();
  await until(2);
  assert.equal(seen[0]?.length, 1, "the first turn never saw the note");
  assert.deepEqual(replies(), ["First answer."]);
});
