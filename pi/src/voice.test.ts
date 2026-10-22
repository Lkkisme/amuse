import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileCredentials } from "./credentials.ts";
import { VoiceUnavailable, transcriber } from "./voice.ts";

const keyed = async (provider: string | null) => {
  const keys = fileCredentials(join(mkdtempSync(join(tmpdir(), "amuse-voice-")), "keys.json"));
  if (provider) await keys.modify(provider, async () => ({ type: "api_key", key: "fw_secret_voice_key" }));
  return keys;
};
const audio = new Uint8Array([1, 2, 3]);

test("without a speech service's key, voice says which keys would do", async () => {
  const transcribe = transcriber(await keyed("anthropic"), () => null, async () => assert.fail("nothing to call"));
  await assert.rejects(transcribe(audio, "audio/webm"), (e: unknown) => e instanceof VoiceUnavailable && /OpenAI, Groq or Fireworks/.test(e.message));
});

test("speech goes to the service the user has a key for, and comes back as text", async () => {
  const asked: { url: string; auth: string | null; model: unknown; name: unknown }[] = [];
  const http: typeof fetch = async (input, init) => {
    const form = init?.body instanceof FormData ? init.body : null;
    const file = form?.get("file");
    asked.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), model: form?.get("model"), name: file instanceof File ? file.name : null });
    return new Response(JSON.stringify({ text: " 明天早上九点开会 " }), { status: 200 });
  };
  const text = await transcriber(await keyed("fireworks"), () => null, http)(audio, "audio/ogg;codecs=opus");
  assert.equal(text, "明天早上九点开会");
  assert.deepEqual(asked, [
    { url: "https://api.fireworks.ai/inference/v1/audio/transcriptions", auth: "Bearer fw_secret_voice_key", model: "whisper-v3-turbo", name: "speech.ogg" },
  ]);
});

test("a service's refusal reads plainly, never with the key", async () => {
  const http: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid key fw_secret_voice_key" } }), { status: 401 });
  await assert.rejects(transcriber(await keyed("fireworks"), () => null, http)(audio, "audio/webm"), (e: unknown) => {
    assert.ok(e instanceof VoiceUnavailable);
    assert.match(e.message, /^401 · Invalid key/);
    assert.doesNotMatch(e.message, /fw_secret_voice_key/);
    return true;
  });
});
