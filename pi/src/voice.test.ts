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
    { url: "https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions", auth: "Bearer fw_secret_voice_key", model: "whisper-v3-turbo", name: "speech.ogg" },
  ]);
});

test("a service's refusal reads plainly, says what to do, and never shows the key", async () => {
  const keys = await keyed("fireworks");
  const said = async (status: number, body: unknown) => {
    try {
      await transcriber(keys, () => null, async () => new Response(JSON.stringify(body), { status }))(audio, "audio/webm");
    } catch (e) {
      assert.ok(e instanceof VoiceUnavailable);
      return e.message;
    }
    return assert.fail("it should have been refused");
  };
  const unauthorized = await said(401, { error: { message: "Invalid key fw_secret_voice_key" } });
  assert.match(unauthorized, /^Fireworks did not accept your key for speech \(401\)\..*Settings › Models › Voice/);
  assert.match(await said(503, "no healthy upstream"), /^Fireworks's speech service is not working just now \(503\)/);
  assert.match(await said(429, {}), /turning requests away just now \(429\)/);
  const other = await said(400, { error: { message: "Audio too short fw_secret_voice_key" } });
  assert.match(other, /^Fireworks could not turn that into text \(400: Audio too short/);
  for (const message of [unauthorized, other]) assert.doesNotMatch(message, /fw_secret_voice_key/);
});
