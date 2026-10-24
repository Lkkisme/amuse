import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { memoryRules } from "@amuse/core";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { piAgent } from "./agent.ts";
import { fileCredentials } from "./credentials.ts";
import { memoryChoices, piKeys } from "./keys.ts";
import { NoModel, openSession } from "./session.ts";

type RequestMessage = { role: string; content: string | { type: string; text: string }[] };

function messagesOf(request: Record<string, unknown>): RequestMessage[] {
  return request["messages"] as RequestMessage[];
}

function systemOf(request: Record<string, unknown>): string {
  const message = messagesOf(request)[0]!;
  assert.equal(message.role, "system");
  assert.equal(typeof message.content, "string");
  // Pi adds its scratch cwd to every system prompt; only that generated path
  // differs between otherwise identical session configurations.
  return (message.content as string).replace(/\n\n<cwd>\n[^\n]*\n<\/cwd>$/, "");
}

async function endpoint(t: TestContext, input: ("text" | "image")[] = ["text"]) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    requests.push(JSON.parse(body) as Record<string, unknown>);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({
      id: "mock-reply",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "local-model",
      choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const dir = mkdtempSync(join(tmpdir(), "amuse-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const modelsPath = join(dir, "providers.json");
  writeFileSync(modelsPath, JSON.stringify({
    providers: {
      "local-endpoint": {
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "local-placeholder",
        models: [{
          id: "local-model",
          input,
          reasoning: true,
          maxTokens: 512,
          contextWindow: 8192,
          samplingParams: { temperature: 0.42, top_p: 0.9 },
          compat: { supportsDeveloperRole: false },
        }],
      },
    },
  }));
  const keys = fileCredentials(join(dir, "keys.json"));
  await keys.modify("local-endpoint", async () => ({ type: "api_key", key: "local-placeholder" }));
  return { requests, dir, modelsPath, auth: { kind: "keys" as const, keys }, model: () => "local-endpoint/local-model" };
}

test("a local session can omit output limits while retaining thinking, sampling and payload callbacks", async (t) => {
  const local = await endpoint(t);
  const opened = await openSession({ ...local, thinkingLevel: "medium", omitOutputLimit: true }, "Be brief.", [], {
    caching: { key: "external-harness-output-test", stable: () => ["Reply OK."] },
  });
  t.after(opened.close);
  assert.equal(opened.session.thinkingLevel, "medium");
  let callbacks = 0;
  const original = opened.session.agent.onPayload;
  opened.session.agent.onPayload = async (payload, model) => {
    callbacks++;
    const transformed = await original?.(payload, model);
    return { ...(transformed === undefined ? payload : transformed) as Record<string, unknown>, max_tokens: 7, max_completion_tokens: 8, max_output_tokens: 9, callback_marker: true };
  };
  await opened.session.prompt("Reply OK.");
  assert.equal(callbacks, 1);
  assert.equal(local.requests.length, 1);
  const request = local.requests[0]!;
  for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) assert.equal(field in request, false);
  assert.equal(request["callback_marker"], true);
  assert.equal(request["temperature"], 0.42);
  assert.equal(request["top_p"], 0.9);
  assert.equal(request["reasoning_effort"], "medium");
});

test("browser image sessions reject a text-only model before inference, while a vision session keeps owner and local settings", async (t) => {
  const blind = await endpoint(t);
  await assert.rejects(openSession(blind, "Browser role.", [], { images: true }), (error) => {
    assert.ok(error instanceof NoModel);
    assert.match(error.message, /does not see pictures/);
    return true;
  });
  assert.equal(blind.requests.length, 0);

  const seeing = await endpoint(t, ["text", "image"]);
  const ownerSystem = "OWNER VISION SENTINEL: use Chinese.";
  const opened = await openSession({ ...seeing, ownerSystem, thinkingLevel: "medium", omitOutputLimit: true }, "Browser role.", [], { images: true });
  t.after(opened.close);
  assert.equal(opened.session.thinkingLevel, "medium");
  await opened.session.prompt("Reply OK.");
  assert.equal(seeing.requests.length, 1);
  const request = seeing.requests[0]!;
  assert.match(systemOf(request), /Browser role\./);
  assert.ok(systemOf(request).includes(ownerSystem));
  for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) assert.equal(field in request, false);
});

test("sessions keep their existing thinking and output defaults unless explicitly configured", async (t) => {
  const local = await endpoint(t);
  const opened = await openSession(local, "Be brief.", []);
  t.after(opened.close);
  assert.equal(opened.session.thinkingLevel, "off");
  await opened.session.prompt("Reply OK.");
  assert.equal(local.requests.length, 1);
  assert.equal(local.requests[0]!["max_completion_tokens"], 512);
  assert.equal(local.requests[0]!["temperature"], 0.42);
  assert.equal(systemOf(local.requests[0]!), "Be brief.");
  assert.deepEqual(messagesOf(local.requests[0]!).map((message) => message.role), ["system", "user"]);
  assert.deepEqual(messagesOf(local.requests[0]!)[1]!.content, [{ type: "text", text: "Reply OK." }]);
});

test("owner configuration reaches each operational system prompt without changing its role or tool schema", async (t) => {
  const local = await endpoint(t);
  const ownerSystem = "OWNER SENTINEL: use Markdown and start every user-facing reply with REG.";
  const cfg = { ...local, ownerSystem };
  const tool = defineTool({
    name: "inspect_fixture",
    label: "Inspect fixture",
    description: "Read the requested fixture. Does not write files.",
    parameters: Type.Object({ path: Type.String(), status: Type.String() }),
    async execute() {
      assert.fail("The mock endpoint must not execute a tool.");
    },
  });
  const roles = [
    "You are the main chat assistant. Plain text only.",
    "You are a background task helper. Your output goes to the main assistant.",
    "You are a scheduled-run helper. Report only changes within the assigned work.",
    "You are a browser agent. Operate only the assigned browser using available tools.",
  ];
  for (const role of roles) {
    const opened = await openSession(cfg, role, [tool]);
    try {
      await opened.session.prompt("USER SENTINEL: reply OK.");
    } finally {
      opened.close();
    }
  }
  assert.equal(local.requests.length, roles.length);
  for (const [index, request] of local.requests.entries()) {
    const messages = messagesOf(request);
    assert.deepEqual(messages.map((message) => message.role), ["system", "user"]);
    const system = systemOf(request);
    assert.ok(system.startsWith(roles[index]!));
    assert.equal(system.split(ownerSystem).length - 1, 1);
    assert.match(system, /override the default assistant persona/);
    assert.match(system, /Keep this operation's assigned role and task boundary/);
    assert.match(system, /Actual tool names, input schemas, required arguments, permissions and protocol requirements remain authoritative/);
    assert.match(system, /does not add tools or capabilities/);
    assert.deepEqual(messages[1]!.content, [{ type: "text", text: "USER SENTINEL: reply OK." }]);
    const tools = request["tools"] as { type: string; function: { name: string; description: string; parameters: { properties: unknown; required: string[] } } }[];
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.type, "function");
    assert.equal(tools[0]!.function.name, tool.name);
    assert.equal(tools[0]!.function.description, tool.description);
    assert.deepEqual(tools[0]!.function.parameters.properties, { path: { type: "string" }, status: { type: "string" } });
    assert.deepEqual(tools[0]!.function.parameters.required, ["path", "status"]);
  }
});

test("blank owner configuration preserves the existing system prompt", async (t) => {
  const local = await endpoint(t);
  const opened = await openSession({ ...local, ownerSystem: "  \n  " }, "ROLE SENTINEL: be brief.", []);
  t.after(opened.close);
  await opened.session.prompt("Reply OK.");
  assert.equal(systemOf(local.requests[0]!), "ROLE SENTINEL: be brief.");
});

test("chat title utility omits owner reply wrappers and the operational chat system", async (t) => {
  const local = await endpoint(t);
  const agent = piAgent({
    ...local,
    ownerSystem: "OWNER SENTINEL: every reply must start with REG.",
    system: "ROLE SENTINEL: the user's main assistant.",
    rules: memoryRules(),
  });
  assert.equal(await agent.title("USER SENTINEL: name this chat."), "OK");
  assert.equal(local.requests.length, 1);
  const request = local.requests[0]!;
  const messages = messagesOf(request);
  assert.deepEqual(messages.map((message) => message.role), ["system", "user"]);
  assert.match(systemOf(request), /You name chats/);
  assert.doesNotMatch(systemOf(request), /OWNER SENTINEL|ROLE SENTINEL|REG/);
  assert.deepEqual(messages[1]!.content, [{ type: "text", text: "USER SENTINEL: name this chat." }]);
  assert.ok(request["tools"] === undefined || (request["tools"] as unknown[]).length === 0);
});

test("provider tests keep their default cap and honor the optional server output limit", async (t) => {
  const local = await endpoint(t);
  const defaults = piKeys({ keys: local.auth.keys, choices: memoryChoices(), modelsPath: local.modelsPath });
  assert.equal((await defaults.test("local-endpoint")).ok, true);
  assert.equal(local.requests[0]!["max_completion_tokens"], 32);
  const keys = piKeys({ keys: local.auth.keys, choices: memoryChoices(), modelsPath: local.modelsPath, omitOutputLimit: true });
  assert.equal((await keys.test("local-endpoint")).ok, true);
  assert.equal(local.requests.length, 2);
  for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) assert.equal(field in local.requests[1]!, false);
  assert.equal(local.requests[1]!["temperature"], 0.42);
});
