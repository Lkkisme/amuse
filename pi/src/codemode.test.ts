import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type TranscriptContext, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sessionOn } from "./session.ts";

/** What the model was last given as a tool's result, as text. */
const lastResult = (context: TranscriptContext): string => {
  const result = [...context.messages].reverse().find((m) => m.role === "toolResult");
  return result?.role === "toolResult" ? result.content.map((c) => (c.type === "text" ? c.text : "")).join("") : "";
};

test("codemode: a script calls the session's own tools, and the model gets what the script gives", async () => {
  const asked: number[] = [];
  const lookup = defineTool({
    name: "lookup",
    label: "Look up",
    description: "Look up a number",
    parameters: Type.Object({ n: Type.Number() }),
    async execute(_, { n }) {
      asked.push(n);
      return { content: [{ type: "text", text: `value ${n * 10}` }], details: null };
    },
  });
  const models = await ModelRuntime.create({ authPath: join(mkdtempSync(join(tmpdir(), "amuse-auth-")), "auth.json"), modelsPath: null, refreshOnCreate: false });
  const faux = fauxProvider({ provider: "faux", models: [{ id: "scripted" }] });
  models.registerNativeProvider(faux.provider);
  let seen = "";
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("codemode", {
        code: "const [a, b] = await Promise.all([tools.lookup({ n: 1 }), tools.lookup({ n: 2 })]);\ntext(`${a} + ${b}`);",
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      seen = lastResult(context);
      return fauxAssistantMessage("done");
    },
  ]);
  const { session, close } = await sessionOn(models, faux.getModel(), "You are a test.", [lookup], { codemode: true });
  try {
    assert.ok(session.getActiveToolNames().includes("codemode"));
    await session.prompt("go", { expandPromptTemplates: false });
    assert.deepEqual([...asked].sort(), [1, 2]);
    assert.match(seen, /Script completed/);
    assert.match(seen, /value 10 \+ value 20/);
  } finally {
    session.dispose();
    close();
  }
});
