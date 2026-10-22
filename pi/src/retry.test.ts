import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { chat } from "./scripted-chat.ts";

test("a model service that fails and then answers on retry shows the reply, not a failure card too", { timeout: 20_000 }, async () => {
  const { agent, io, replies, failures, until } = await chat([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "502 Bad Gateway" }),
    fauxAssistantMessage("Here you are."),
  ]);
  agent.prompt({ kind: "message", text: "hello", attachments: [] }, io);
  await until(1);
  assert.deepEqual(replies(), ["Here you are."]);
  assert.deepEqual(failures(), []);
});
