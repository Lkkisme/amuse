/**
 * Voice: what the user says into the mic, as text for the composer. A
 * provider's speech-to-text does it (an OpenAI-style /audio/transcriptions),
 * with the user's selected local server or their own provider key.
 * Pi does not do speech; this is the one place outside it that calls a
 * provider, and it reads the key from the user's keys like Pi does.
 */
import type { KeyFile } from "./credentials.ts";
import { LOCAL_VOICE } from "./credentials.ts";
import { plainly } from "./keys.ts";
import { redact } from "./redact.ts";

/** The speech-to-text services, in the order they are tried (by provider id, as in the keys). */
export const voiceServices = [
  { provider: "openai", name: "OpenAI (GPT-4o mini Transcribe)", url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  { provider: "groq", name: "Groq (Whisper large v3 turbo)", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  // Fireworks serves speech from a host of its own, not its API's (which answers 401 there)
  { provider: "fireworks", name: "Fireworks (Whisper v3 turbo)", url: "https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions", model: "whisper-v3-turbo" },
];

/** Speech cannot be turned into text: why, in words for the user. */
export class VoiceUnavailable extends Error {}

/** Why a speech service said no, in words: what it means, and what the user can do; `detail`: what it said, made plain. */
export function refusal(service: string, status: number, detail: string): string {
  const who = service.replace(/ \(.*\)$/, "");
  const elsewhere = "or choose another service in Settings › Models › Voice";
  if (status === 401 || status === 403) return `${who} did not accept your key for speech (${status}). Check that the key may use speech, ${elsewhere}.`;
  if (status === 429) return `${who} is turning requests away just now (429). Try again in a moment.`;
  if (status >= 500) return `${who}'s speech service is not working just now (${status}). Try again later, ${elsewhere}.`;
  return `${who} could not turn that into text (${status}${detail ? `: ${detail}` : ""}).`;
}

/** Preserve the recording's format for local decoders and provider upload validation. */
const fileName = (type: string) => `speech.${type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("wav") ? "wav" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : "webm"}`;

/** A server's transcription endpoint from its base address (".../v1" or the endpoint itself). */
export const transcriptionsAt = (url: string) => (/\/audio\/transcriptions\/?$/.test(url) ? url : `${url.replace(/\/+$/, "")}/audio/transcriptions`);

/**
 * `choice`: the provider the user chose for speech ("local": their own server; null: the first
 * cloud one with a key, then their own). `local`: their own server, when set up.
 */
export function transcriber(
  keys: KeyFile,
  choice: () => string | null = () => null,
  http: typeof fetch = fetch,
  local: () => { url: string; model: string } | null = () => null,
) {
  return async (audio: Uint8Array, type: string): Promise<string> => {
    const chosen = choice();
    const own = local();
    const candidates = [
      ...voiceServices.map((s) => ({ ...s, keyed: true })),
      ...(own ? [{ provider: LOCAL_VOICE, name: "Your own server", url: transcriptionsAt(own.url), model: own.model, keyed: false }] : []),
    ].filter((s) => chosen === null || s.provider === (chosen === "local" ? LOCAL_VOICE : chosen));
    for (const service of candidates) {
      const credential = await keys.read(service.provider);
      const key = credential?.type === "api_key" ? credential.key : undefined;
      // a cloud service needs the user's key; their own server may take none
      if (service.keyed && !key) continue;
      const form = new FormData();
      form.append("model", service.model);
      form.append("file", new Blob([new Uint8Array(audio)], { type: type || "audio/webm" }), fileName(type));
      const response = await http(service.url, { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: form, signal: AbortSignal.timeout(60_000) }).catch(
        (e: unknown) => {
          throw new VoiceUnavailable(`The speech service could not be reached: ${e instanceof Error ? e.message : String(e)}`);
        },
      );
      const said: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new VoiceUnavailable(refusal(service.name, response.status, redact(plainly(JSON.stringify(said ?? "")), keys.secrets()).slice(0, 200)));
      const text = typeof said === "object" && said !== null && "text" in said && typeof said.text === "string" ? said.text : "";
      return text.trim();
    }
    throw new VoiceUnavailable("Voice needs a key for OpenAI, Groq or Fireworks, or your own speech server: set one up in Settings › Models.");
  };
}
