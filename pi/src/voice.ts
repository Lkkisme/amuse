/**
 * Voice: what the user says into the mic, as text for the composer. A
 * provider's speech-to-text does it (an OpenAI-style /audio/transcriptions),
 * with the user's own key: OpenAI, Groq or Fireworks, the first one set up.
 * Pi does not do speech; this is the one place outside it that calls a
 * provider, and it reads the key from the user's keys like Pi does.
 */
import type { KeyFile } from "./credentials.ts";
import { plainly } from "./keys.ts";
import { redact } from "./redact.ts";

/** The speech-to-text services, in the order they are tried (by provider id, as in the keys). */
const services = [
  { provider: "openai", url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  { provider: "groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  { provider: "fireworks", url: "https://api.fireworks.ai/inference/v1/audio/transcriptions", model: "whisper-v3-turbo" },
];

/** Speech cannot be turned into text: why, in words for the user. */
export class VoiceUnavailable extends Error {}

/** The audio a recording gives (webm or ogg with opus, mp4 on Safari), as a file name a service takes. */
const fileName = (type: string) => `speech.${type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("wav") ? "wav" : "webm"}`;

export function transcriber(keys: KeyFile, http: typeof fetch = fetch) {
  return async (audio: Uint8Array, type: string): Promise<string> => {
    for (const service of services) {
      const credential = await keys.read(service.provider);
      const key = credential?.type === "api_key" ? credential.key : undefined;
      if (!key) continue;
      const form = new FormData();
      form.append("model", service.model);
      form.append("file", new Blob([new Uint8Array(audio)], { type: type || "audio/webm" }), fileName(type));
      const response = await http(service.url, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60_000) }).catch(
        (e: unknown) => {
          throw new VoiceUnavailable(`The speech service could not be reached: ${e instanceof Error ? e.message : String(e)}`);
        },
      );
      const said: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new VoiceUnavailable(redact(plainly(`${response.status} ${JSON.stringify(said)}`), keys.secrets()));
      const text = typeof said === "object" && said !== null && "text" in said && typeof said.text === "string" ? said.text : "";
      return text.trim();
    }
    throw new VoiceUnavailable("Voice needs a key for OpenAI, Groq or Fireworks: add one in Settings › Models.");
  };
}
