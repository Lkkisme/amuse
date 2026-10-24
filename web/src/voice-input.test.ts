import assert from "node:assert/strict";
import { test } from "node:test";
import { VoiceInput, type VoicePhase } from "./voice-input.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function stream() {
  let stops = 0;
  return { value: { getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream, stops: () => stops };
}

class Recording {
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  stream: MediaStream;
  onstop: MediaRecorder["onstop"] = null;
  ondataavailable: MediaRecorder["ondataavailable"] = null;
  starts = 0;
  stops = 0;
  constructor(stream: MediaStream) { this.stream = stream; }
  start() { this.state = "recording"; this.starts++; }
  stop() {
    this.state = "inactive";
    this.stops++;
    const owner = this as unknown as MediaRecorder;
    this.ondataavailable?.call(owner, { data: new Blob(["recorded audio"]) } as BlobEvent);
    this.onstop?.call(owner, new Event("stop"));
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(acquire?: () => Promise<MediaStream>) {
  const microphone = stream();
  const transcription = deferred<string>();
  const phases: VoicePhase[] = [], texts: string[] = [], errors: string[] = [];
  const recordings: Recording[] = [];
  const requests: { audio: Blob; signal: AbortSignal }[] = [];
  let acquisitions = 0;
  const input = new VoiceInput({
    acquire: () => { acquisitions++; return acquire ? acquire() : Promise.resolve(microphone.value); },
    record: (stream) => { const recording = new Recording(stream); recordings.push(recording); return recording as unknown as MediaRecorder; },
    transcribe: (audio, signal) => { requests.push({ audio, signal }); return transcription.promise; },
    phase: (phase) => phases.push(phase),
    text: (text) => texts.push(text),
    error: (stage) => errors.push(stage),
  });
  return { input, microphone, transcription, phases, texts, errors, recordings, requests, acquisitions: () => acquisitions };
}

test("the user's stop releases the microphone and transcribes the captured audio once", async () => {
  const f = fixture();
  await f.input.listen();
  f.input.stop();
  assert.equal(f.microphone.stops(), 1);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.ok(request);
  assert.equal(await request.audio.text(), "recorded audio");
  assert.equal(request.audio.type, "audio/webm;codecs=opus");
  assert.equal(request.signal.aborted, false);
  f.transcription.resolve("dictated text");
  await flush();
  assert.deepEqual(f.texts, ["dictated text"]);
  assert.deepEqual(f.phases, ["recording", "transcribing", "idle"]);
});

for (const action of ["pause", "dispose"] as const) {
  test(`${action} before a late microphone grant stops its tracks without recording or uploading`, async () => {
    const grant = deferred<MediaStream>();
    const f = fixture(() => grant.promise);
    const listening = f.input.listen();
    await f.input.listen();
    assert.equal(f.acquisitions(), 1, "a second tap cannot open another permission request");
    f.input[action]();
    f.input.resume();
    grant.resolve(f.microphone.value);
    await listening;
    assert.equal(f.microphone.stops(), 1);
    assert.equal(f.recordings.length, 0);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.texts, []);
    assert.deepEqual(f.errors, []);
  });

  test(`${action} discards an active recording, and resume never starts another recording`, async () => {
    const f = fixture();
    await f.input.listen();
    f.input[action]();
    f.input.resume();
    await flush();
    assert.equal(f.microphone.stops(), 1);
    const recording = f.recordings[0];
    assert.ok(recording);
    assert.equal(recording.stops, 1);
    assert.equal(recording.onstop, null);
    assert.equal(f.requests.length, 0);
    assert.equal(f.acquisitions(), 1);
    assert.deepEqual(f.texts, []);
    if (action === "dispose") {
      await f.input.listen();
      assert.equal(f.acquisitions(), 1, "a disposed chat stays disposed");
    }
  });

  test(`${action} aborts transcription and ignores a response that still resolves after cancellation`, async () => {
    const f = fixture();
    await f.input.listen();
    f.input.stop();
    f.input[action]();
    const request = f.requests[0];
    assert.ok(request);
    assert.equal(request.signal.aborted, true);
    const phases = [...f.phases];
    f.transcription.resolve("stale text must not enter the draft");
    await flush();
    assert.deepEqual(f.texts, []);
    assert.deepEqual(f.phases, phases, "an old response cannot update even the voice indicator");
    assert.deepEqual(f.errors, []);
  });
}

test("an old transcription cannot finish a new recording after the page resumes", async () => {
  const f = fixture();
  await f.input.listen();
  f.input.stop();
  f.input.pause();
  f.input.resume();
  await f.input.listen();
  f.transcription.resolve("old text");
  await flush();
  assert.deepEqual(f.texts, []);
  assert.equal(f.phases.at(-1), "recording");
  assert.equal(f.recordings[1]?.state, "recording");
  f.input.dispose();
});

test("late permission and transcription errors remain silent after a pause", async () => {
  const grant = deferred<MediaStream>();
  const f = fixture(() => grant.promise);
  const listening = f.input.listen();
  f.input.pause();
  grant.reject(new Error("late denial"));
  await listening;
  assert.deepEqual(f.errors, []);
  const active = fixture();
  await active.input.listen();
  active.input.stop();
  active.input.pause();
  active.transcription.reject(new Error("request aborted"));
  await flush();
  assert.deepEqual(active.errors, []);
});
