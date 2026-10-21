import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileCredentials } from "./credentials.ts";
import { bare, piKeys, plainly } from "./keys.ts";
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

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const path = join(dir, "keys.json");
  const keys = piKeys({
    keys: fileCredentials(path),
    choicePath: join(dir, "models.json"),
    apps: [composio],
  });
  return { dir, path, keys };
}

test("a provider's key is set up through its own prompts, kept owner-only, and shown only by its end", async () => {
  const { path, keys } = setup();
  let changes = 0;
  keys.onChange(() => changes++);
  const first = await keys.login("fireworks");
  assert.equal(first.kind, "prompt");
  if (first.kind !== "prompt") return;
  assert.equal(first.prompt.type, "secret");
  assert.deepEqual(await keys.answer(first.login, "fw_secret_key_1234"), {
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
    hint: "…1234",
  });
  assert.ok(!JSON.stringify(listed).includes("fw_secret_key_1234"), "the key never comes back");
  assert.ok(listed.models.length > 0 && listed.models.every((m) => m.provider === "fireworks"));
  assert.equal(statSync(path).mode & 0o777, 0o600);

  // a sign-in answered once is over
  assert.equal((await keys.answer(first.login, "again")).kind, "failed");
});

test("models are chosen among those offered; the browser's must see pictures; forgetting the key lets go of them", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "fw_secret_key_1234");
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
  assert.deepEqual(await keys.answer(first.login, "  ak_composio_5678 "), {
    kind: "done",
  });
  assert.equal(keys.appKey("composio"), "ak_composio_5678");
  assert.equal((await keys.list()).providers[0]?.hint, "…5678");

  // kept across restarts
  const again = piKeys({
    keys: fileCredentials(join(dir, "keys.json")),
    choicePath: join(dir, "models.json"),
    apps: [composio],
  });
  await again.list();
  assert.equal(again.appKey("composio"), "ak_composio_5678");
  assert.ok(readFileSync(join(dir, "keys.json"), "utf8").includes("ak_composio_5678"));
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
    choicePath: join(dir, "models.json"),
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
  await keys.answer(first.login, "ak_composio_5678");
  assert.deepEqual(await keys.test("composio"), { ok: true, detail: "The key works." });
  works = false;
  const failed = await keys.test("composio");
  assert.equal(failed.ok, false);
  assert.ok(failed.detail.includes("401") && !failed.detail.includes("ak_composio_5678"));
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
  const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choicePath: join(dir, "models.json"), apps: [composio] });
  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "COMPOSIO_API_KEY=ak_composio_5678");
  assert.equal(keys.appKey("composio"), "ak_composio_5678");
});

test("each role's model thinks as much as chosen, within what the model takes; another model keeps the nearest level", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choicePath: join(dir, "models.json") });
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

test("scheduled work runs on the chat's model until it has one of its own, and goes back to it", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "fw_secret_key_1234");
  const [a, b] = (await keys.list()).models;
  assert.ok(a && b);
  await keys.choose("chat", a.id);
  assert.equal(keys.model("background"), a.id);
  await keys.choose("background", b.id);
  assert.equal(keys.model("background"), b.id);
  assert.equal((await keys.list()).background, b.id);
  await keys.choose("background", null);
  assert.equal(keys.model("background"), a.id);
  await assert.rejects(keys.choose("chat", null), /needs a model/);
});

test("the mic's speech service is chosen among those with a key; none chosen means the first of them", async () => {
  const { keys } = setup();
  assert.deepEqual((await keys.list()).voice, { services: [], chosen: null, local: null });
  for (const provider of ["fireworks", "groq"]) {
    const first = await keys.login(provider);
    if (first.kind !== "prompt") return assert.fail("expected a prompt");
    await keys.answer(first.login, "secret_key_1234");
  }
  const { voice } = await keys.list();
  assert.deepEqual(voice.services.map((s) => s.provider), ["groq", "fireworks"]);
  assert.equal(voice.chosen, null);
  await keys.voice("fireworks");
  assert.equal(keys.voiceChoice(), "fireworks");
  await assert.rejects(keys.voice("openai"), /Add a key for openai/);
  await assert.rejects(keys.voice("anthropic"), /does not turn speech into text/);
  await keys.voice(null);
  assert.equal(keys.voiceChoice(), null);
});

test("a chosen speech service is the one used", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const store = fileCredentials(join(dir, "keys.json"));
  await store.modify("groq", async () => ({ type: "api_key", key: "gsk_1" }));
  await store.modify("fireworks", async () => ({ type: "api_key", key: "fw_1" }));
  const asked: string[] = [];
  const http: typeof fetch = async (input) => (asked.push(String(input)), new Response(JSON.stringify({ text: "hi" })));
  await transcriber(store, () => "fireworks", http)(new Uint8Array([1]), "audio/webm");
  await transcriber(store, () => null, http)(new Uint8Array([1]), "audio/webm");
  assert.deepEqual(asked.map((u) => new URL(u).hostname), ["api.fireworks.ai", "api.groq.com"]);
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
