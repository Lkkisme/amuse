import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileCredentials } from "./credentials.ts";
import { type Choice, type PiKeys, adoptEnvironment, bare, memoryChoices, piKeys, plainly } from "./keys.ts";
import { runtime } from "./session.ts";
import { transcriber } from "./voice.ts";

const composio = {
  id: "composio",
  name: "Composio",
  message: "Enter your Composio API key",
  where: "On composio.dev.",
  link: {
    url: "https://composio.dev/",
    label: "composio.dev",
  },
};

function setup(choices: Choice | null = null, http: typeof fetch = fetch) {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const path = join(dir, "keys.json");
  const keys = piKeys({
    keys: fileCredentials(path),
    choices: memoryChoices(choices),
    apps: [composio],
    http,
  });
  return { dir, path, keys };
}

/** A provider set up with a key through its own prompt. */
async function keyed(keys: PiKeys, provider: string, key = "gsk_fake_key_1234") {
  const first = await keys.login(provider);
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, key);
}

test("a provider's key is set up through its own prompts, kept owner-only, and shown only by its end", async () => {
  const { path, keys } = setup();
  let changes = 0;
  keys.onChange(() => changes++);
  const first = await keys.login("fireworks");
  assert.equal(first.kind, "prompt");
  if (first.kind !== "prompt") return;
  assert.equal(first.prompt.type, "secret");
  assert.deepEqual(await keys.answer(first.login, "fw_secret_key_fake_value_1234"), {
    kind: "done",
  });
  assert.equal(changes, 1);

  const listed = await keys.list();
  const fireworks = listed.providers.find((p) => p.id === "fireworks");
  assert.deepEqual(fireworks, {
    id: "fireworks",
    name: fireworks?.name,
    use: "models",
    connected: true,
    way: "key",
    hint: "…1234",
    account: null,
    guide: { home: "https://fireworks.ai/", keys: "https://app.fireworks.ai/settings/users/api-keys", docs: null, note: null },
  });
  assert.ok(!JSON.stringify(listed).includes("fw_secret_key_fake_value_1234"), "the key never comes back");
  assert.ok(listed.models.length > 0 && listed.models.every((m) => m.provider === "fireworks"));
  // Windows uses inherited ACLs rather than POSIX mode bits.
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);

  // a sign-in answered once is over
  assert.equal((await keys.answer(first.login, "again")).kind, "failed");
});

test("models are chosen among those offered; the browser's must see pictures; forgetting the key lets go of them", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "fw_secret_key_fake_value_1234");
  const { models } = await keys.list();
  const seeing = models.find((m) => m.images);
  const blind = models.find((m) => !m.images);
  assert.ok(seeing && blind);

  await assert.rejects(keys.choose("chat", "nowhere/model"));
  await keys.choose("chat", blind.id);
  await assert.rejects(keys.choose("browser", blind.id), /pictures/);
  await keys.choose("browser", seeing.id);
  assert.equal(keys.model("chat"), blind.id);
  assert.equal(keys.model("browser"), seeing.id);

  await keys.logout("fireworks");
  assert.equal(keys.model("chat"), null);
  assert.equal(keys.model("browser"), null);
  const after = await keys.list();
  assert.equal(after.providers.find((p) => p.id === "fireworks")?.connected, false);
  assert.deepEqual(after.models, []);
});

test("an app's key is asked for with where to get it, and read back by the server only", async () => {
  const { dir, keys } = setup();
  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  assert.equal(first.notes[0]?.links[0]?.url, composio.link.url);
  assert.deepEqual(await keys.answer(first.login, "  ak_composio_fake_value_5678 "), {
    kind: "done",
  });
  assert.equal(keys.appKey("composio"), "ak_composio_fake_value_5678");
  assert.equal((await keys.list()).providers[0]?.hint, "…5678");

  // kept across restarts
  const again = piKeys({
    keys: fileCredentials(join(dir, "keys.json")),
    choices: memoryChoices(),
    apps: [composio],
  });
  await again.list();
  assert.equal(again.appKey("composio"), "ak_composio_fake_value_5678");
  assert.ok(readFileSync(join(dir, "keys.json"), "utf8").includes("ak_composio_fake_value_5678"));
});

test("a sign-in can be stopped, and an unknown provider is refused", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.cancel(first.login);
  assert.equal((await keys.answer(first.login, "late")).kind, "failed");
  assert.equal((await keys.list()).providers.find((p) => p.id === "fireworks")?.connected, false);
  assert.equal((await keys.login("no-such-provider")).kind, "failed");
});

test("a key is tried on request: none set up says so; an app's test says how it went, never echoing the key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  let works = true;
  const keys = piKeys({
    keys: fileCredentials(join(dir, "keys.json")),
    choices: memoryChoices(),
    apps: [
      {
        ...composio,
        test: async (key) => {
          if (!works) throw new Error(`401 Unauthorized for ${key}`);
        },
      },
    ],
  });
  assert.deepEqual(await keys.test("fireworks"), { ok: false, detail: "No key is set up." });
  assert.deepEqual(await keys.test("composio"), { ok: false, detail: "No key is set up." });

  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "ak_composio_fake_value_5678");
  assert.deepEqual(await keys.test("composio"), { ok: true, detail: "The key works." });
  works = false;
  const failed = await keys.test("composio");
  assert.equal(failed.ok, false);
  assert.ok(failed.detail.includes("401") && !failed.detail.includes("ak_composio_fake_value_5678"));
});

test("a provider's error reads plainly", () => {
  assert.equal(
    plainly('401 {"type":"error","error":{"type":"authentication_error","message":"The API key you provided is invalid."},"request_id":"x"}'),
    "401 · The API key you provided is invalid.",
  );
  assert.equal(plainly('{"error":"Invalid token"}'), "Invalid token");
  assert.equal(plainly("fetch failed"), "fetch failed");
  assert.equal(plainly("500 {not json"), "500 {not json");
});

test("a key pasted as an env file line gives its value", async () => {
  assert.equal(bare("COMPOSIO_API_KEY=ak_abc123"), "ak_abc123");
  assert.equal(bare('  export FIREWORKS_API_KEY="fw_abc" \n'), "fw_abc");
  assert.equal(bare("OPENROUTER_API_KEY = 'sk-or-1'"), "sk-or-1");
  assert.equal(bare(" ak_plain "), "ak_plain");
  assert.equal(bare("sk-with=equals"), "sk-with=equals");
  assert.equal(bare("abcDEF123=="), "abcDEF123==");
  assert.equal(bare("KEY="), "KEY=");

  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choices: memoryChoices(), apps: [composio] });
  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "COMPOSIO_API_KEY=ak_composio_fake_value_5678");
  assert.equal(keys.appKey("composio"), "ak_composio_fake_value_5678");
});

test("custom local providers are adopted from the environment and offered for selection", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-local-provider-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keysPath = join(dir, "keys.json");
  const choices = memoryChoices();
  const credentials = fileCredentials(keysPath);
  const modelsPath = join(dir, "providers.json");
  writeFileSync(modelsPath, JSON.stringify({
    providers: {
      "swift-local": {
        name: "Local Swift",
        baseUrl: "http://127.0.0.1:8080/v1",
        api: "openai-completions",
        apiKey: "local-placeholder",
        models: [{ id: "swift", name: "Swift", input: ["text", "image"] }],
      },
    },
  }));
  const env = {
    SWIFT_LOCAL_API_KEY: "local-placeholder",
    AMUSE_PI_MODEL: "swift-local/swift",
    AMUSE_PI_BROWSER_MODEL: "swift-local/swift",
  };
  assert.deepEqual(await adoptEnvironment({ keys: credentials, choices, modelsPath, apps: {}, env }), ["swift-local"]);
  const keys = piKeys({ keys: credentials, choices, modelsPath });
  const listed = await keys.list();
  assert.equal(listed.providers.find((p) => p.id === "swift-local")?.connected, true);
  assert.deepEqual(listed.models, [{ id: "swift-local/swift", name: "Swift", provider: "swift-local", images: true, thinking: ["off"] }]);
  assert.equal(keys.model("chat"), "swift-local/swift");
  await keys.choose("browser", "swift-local/swift");
  assert.equal(keys.model("browser"), "swift-local/swift");
  // The API now guards adoption with its new-Vault marker. Reopening the
  // persisted stores keeps the models selected through the app.
  const reopened = piKeys({ keys: credentials, choices, modelsPath });
  assert.equal(reopened.model("chat"), "swift-local/swift");
  assert.equal(reopened.model("browser"), "swift-local/swift");
});

test("a credential source caches separate runtimes for separate custom model files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-model-runtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keys = fileCredentials(join(dir, "keys.json"));
  const modelsPath = join(dir, "providers.json");
  writeFileSync(modelsPath, JSON.stringify({
    providers: {
      "private-endpoint": {
        baseUrl: "http://127.0.0.1:8080/v1",
        api: "openai-completions",
        apiKey: "placeholder",
        models: [{ id: "private-model" }],
      },
    },
  }));
  const withoutCustomModels = await runtime({ auth: { kind: "keys", keys } });
  const withCustomModels = await runtime({ auth: { kind: "keys", keys }, modelsPath });
  assert.notEqual(withCustomModels, withoutCustomModels);
  assert.equal(withoutCustomModels.getModel("private-endpoint", "private-model"), undefined);
  assert.ok(withCustomModels.getModel("private-endpoint", "private-model"));
  assert.equal(await runtime({ auth: { kind: "keys", keys }, modelsPath }), withCustomModels);
});

test("each role's model thinks as much as chosen, within what the model takes; another model keeps the nearest level", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choices: memoryChoices() });
  for (const provider of ["fireworks", "openrouter"]) {
    const first = await keys.login(provider);
    if (first.kind !== "prompt") return assert.fail("expected a prompt");
    await keys.answer(first.login, "secret_key_1234");
  }
  const { models } = await keys.list();
  const thinker = models.find((m) => m.thinking.includes("off") && m.thinking.includes("high"));
  const plain = models.find((m) => m.thinking.length === 1 && m.thinking[0] === "off");
  const always = models.find((m) => m.images && !m.thinking.includes("off"));
  assert.ok(thinker && plain && always, "models that think, that do not, and that always do");

  await assert.rejects(keys.think("chat", "high"), /Choose a model first/);
  await keys.choose("chat", thinker.id);
  assert.equal(keys.thinking("chat"), "off");
  await keys.think("chat", "high");
  assert.equal(keys.thinking("chat"), "high");
  assert.deepEqual((await keys.list()).thinking, { chat: "high", browser: "off", background: "off" });

  await keys.choose("chat", plain.id);
  assert.equal(keys.thinking("chat"), "off", "a model that does not think");
  await assert.rejects(keys.think("chat", "high"), /does not take/);

  // a model that cannot be off thinks at the nearest level it takes, and says so
  await keys.choose("browser", always.id);
  const shown = (await keys.list()).thinking.browser;
  assert.ok(always.thinking.includes(shown), `${shown} is one of ${always.thinking.join(",")}`);
});

test("the browser and scheduled work run on the chat's model until they have one of their own, and go back to it", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "fw_secret_key_fake_value_1234");
  const [a, b] = (await keys.list()).models;
  assert.ok(a && b);
  await keys.choose("chat", a.id);
  assert.equal(keys.model("background"), a.id);
  await keys.choose("background", b.id);
  assert.equal(keys.model("background"), b.id);
  assert.equal((await keys.list()).background, b.id);
  await keys.choose("background", null);
  assert.equal(keys.model("background"), a.id);
  assert.equal(keys.model("browser"), a.id);
  await keys.choose("browser", b.id);
  assert.equal(keys.model("browser"), b.id);
  await keys.choose("browser", null);
  assert.equal(keys.model("browser"), a.id);
  assert.equal((await keys.list()).browser, null);
  await assert.rejects(keys.choose("chat", null), /needs a model/);
});

test("the mic's speech service is chosen among those with a key; none chosen means the first of them", async () => {
  const { keys } = setup();
  assert.deepEqual((await keys.list()).voice, { services: [], chosen: null, local: null });
  for (const provider of ["openai", "groq"]) await keyed(keys, provider);
  const { voice } = await keys.list();
  assert.deepEqual(voice.services.map((s) => s.provider), ["openai", "groq"]);
  assert.equal(voice.chosen, null);
  await keys.voice("groq");
  assert.equal(keys.voiceChoice(), "groq");
  await assert.rejects(keys.voice("anthropic"), /does not turn speech into text/);
  await assert.rejects(keys.voice("fireworks"), /does not turn speech into text/, "Fireworks no longer serves speech");
  await keys.logout("openai");
  await assert.rejects(keys.voice("openai"), /Add a key for openai/);
  await keys.voice(null);
  assert.equal(keys.voiceChoice(), null);
});

test("a speech service that is gone leaves the choice unset, so the next one is used", async () => {
  const { keys } = setup({ chat: null, browser: null, background: null, voice: "fireworks", localVoice: null, installation: null, thinking: { chat: "off", browser: "off", background: "off" } });
  assert.equal(keys.voiceChoice(), null);
  assert.equal((await keys.list()).voice.chosen, null);
});

test("a key is tried on the provider's own list of models, where its API answers one", async () => {
  const asked: { url: string; auth: string | null }[] = [];
  const http: typeof fetch = async (input, init) => {
    asked.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 });
  };
  const { keys } = setup(null, http);
  await keyed(keys, "groq");
  assert.deepEqual(await keys.test("groq"), { ok: true, detail: "The key works." });
  assert.deepEqual(asked, [{ url: "https://api.groq.com/openai/v1/models", auth: "Bearer gsk_fake_key_1234" }]);
});

test("a key the provider turns away is said so, and never shown", async () => {
  const http: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
  const { keys } = setup(null, http);
  await keyed(keys, "groq");
  const tried = await keys.test("groq");
  assert.equal(tried.ok, false);
  assert.equal(tried.detail, "401 · Invalid API Key");
  assert.ok(!tried.detail.includes("gsk_fake_key_1234"));
});

test("a chat model the provider has retired is not read as a key that does not work", async () => {
  const asked: string[] = [];
  const http: typeof fetch = async (_input, init) => {
    const body: unknown = JSON.parse(String(init?.body ?? ""));
    const model = typeof body === "object" && body !== null && "model" in body && typeof body.model === "string" ? body.model : "";
    asked.push(model);
    return new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `model: ${model} not found` } }), { status: 404 });
  };
  const { keys } = setup(null, http);
  await keyed(keys, "anthropic");
  const tried = await keys.test("anthropic");
  assert.equal(tried.ok, true, tried.detail);
  assert.match(tried.detail, /^The key works, but .+ is gone from anthropic's catalogue\.$/);
  assert.ok(asked.length > 1, `the next models are tried too: ${asked.join(", ")}`);
});

test("fallback key tests keep local output-limit omission when trying catalogue alternatives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-key-test-limit-"));
  const payloads: Record<string, unknown>[] = [];
  const http: typeof fetch = async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model not found" } }), { status: 404 });
  };
  try {
    const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choices: memoryChoices(), omitOutputLimit: true, http });
    await keyed(keys, "anthropic");
    assert.equal((await keys.test("anthropic")).ok, true);
    assert.ok(payloads.length > 1);
    for (const payload of payloads) {
      assert.equal("max_tokens" in payload || "max_completion_tokens" in payload || "max_output_tokens" in payload, false);
      assert.ok(payload["model"]);
    }
    assert.equal(keys.model("chat"), null, "testing credentials never changes the selected model");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a chosen speech service is the one used", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const store = fileCredentials(join(dir, "keys.json"));
  await store.modify("groq", async () => ({ type: "api_key", key: "gsk_1" }));
  await store.modify("openai", async () => ({ type: "api_key", key: "sk_1" }));
  const asked: string[] = [];
  const http: typeof fetch = async (input) => (asked.push(String(input)), new Response(JSON.stringify({ text: "hi" })));
  await transcriber(store, () => "groq", http)(new Uint8Array([1]), "audio/webm");
  await transcriber(store, () => null, http)(new Uint8Array([1]), "audio/webm");
  assert.deepEqual(asked.map((u) => new URL(u).hostname), ["api.groq.com", "api.openai.com"]);
});

test("the user's own speech server: set up, chosen, called without a key when it has none, and removed", async () => {
  const { keys } = setup();
  await assert.rejects(keys.voice("local"), /Set up your own speech server first/);
  await assert.rejects(keys.localVoice({ url: "host:8000", model: "whisper", key: null }), /http/);
  await keys.localVoice({ url: "http://host.docker.internal:8000/v1/", model: "Systran/faster-whisper-small", key: null });
  const { voice } = await keys.list();
  assert.deepEqual(voice.local, { url: "http://host.docker.internal:8000/v1/", model: "Systran/faster-whisper-small" });
  assert.deepEqual(voice.services, [{ provider: "local", name: "Your own server (Systran/faster-whisper-small)" }]);
  await keys.voice("local");
  assert.equal(keys.voiceChoice(), "local");
  await keys.localVoice(null);
  assert.equal(keys.voiceChoice(), null, "removing the server lets go of the choice");
  assert.equal(keys.localVoiceService(), null);
});

test("speech goes to the user's own server at its transcriptions endpoint, with its key only if it has one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const store = fileCredentials(join(dir, "keys.json"));
  const asked: { url: string; auth: string | null }[] = [];
  const http: typeof fetch = async (input, init) => (asked.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") }), new Response(JSON.stringify({ text: "本地转写" })));
  const own = () => ({ url: "http://host.docker.internal:8000/v1/", model: "Systran/faster-whisper-small" });
  assert.equal(await transcriber(store, () => "local", http, own)(new Uint8Array([1]), "audio/webm"), "本地转写");
  await store.modify("local-voice", async () => ({ type: "api_key", key: "local_secret" }));
  await transcriber(store, () => null, http, own)(new Uint8Array([1]), "audio/webm");
  assert.deepEqual(asked, [
    { url: "http://host.docker.internal:8000/v1/audio/transcriptions", auth: null },
    { url: "http://host.docker.internal:8000/v1/audio/transcriptions", auth: "Bearer local_secret" },
  ]);
});
