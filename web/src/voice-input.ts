export type VoicePhase = "idle" | "recording" | "transcribing";
type Failure = "permission" | "recording" | "transcribing";
type VoicePorts = {
  acquire(): Promise<MediaStream>;
  record(stream: MediaStream): MediaRecorder;
  monitor?(stream: MediaStream): () => void;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  phase(phase: VoicePhase): void;
  text(text: string): void;
  error(stage: Failure, error: unknown): void;
};

/** A permission grant or transcription can arrive after the page has been hidden. */
export class VoiceInput {
  private readonly ports: VoicePorts;
  private generation = 0;
  private active = true;
  private disposed = false;
  private busy = false;
  private recording: MediaRecorder | null = null;
  private transcription: AbortController | null = null;
  private releaseStream: (() => void) | null = null;

  constructor(ports: VoicePorts) { this.ports = ports; }

  private current(generation: number) {
    return !this.disposed && this.active && this.generation === generation;
  }

  async listen(): Promise<void> {
    if (!this.active || this.disposed || this.busy) return;
    this.busy = true;
    const generation = ++this.generation;
    let stream: MediaStream;
    try { stream = await this.ports.acquire(); }
    catch (error) {
      if (this.current(generation)) {
        this.busy = false;
        this.ports.error("permission", error);
      }
      return;
    }
    let released = false;
    let stopMonitoring: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      stopMonitoring?.();
      stream.getTracks().forEach((track) => track.stop());
      if (this.releaseStream === release) this.releaseStream = null;
    };
    if (!this.current(generation)) { release(); return; }
    this.releaseStream = release;
    let recording: MediaRecorder;
    try {
      recording = this.ports.record(stream);
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => {
        if (this.current(generation) && this.recording === recording) chunks.push(event.data);
      };
      recording.onstop = () => {
        release();
        if (!this.current(generation) || this.recording !== recording) return;
        this.recording = null;
        const request = new AbortController();
        this.transcription = request;
        this.ports.phase("transcribing");
        const audio = new Blob(chunks, { type: recording.mimeType || "audio/webm" });
        void this.ports.transcribe(audio, request.signal).then(
          (text) => { if (this.current(generation)) this.ports.text(text); },
          (error: unknown) => { if (this.current(generation)) this.ports.error("transcribing", error); },
        ).finally(() => {
          if (!this.current(generation)) return;
          this.transcription = null;
          this.busy = false;
          this.ports.phase("idle");
        });
      };
      recording.onerror = (error) => {
        if (!this.current(generation) || this.recording !== recording) return;
        this.discard();
        this.ports.error("recording", error);
      };
      this.recording = recording;
      recording.start();
      stopMonitoring = this.ports.monitor?.(stream);
      this.ports.phase("recording");
    } catch (error) {
      if (this.recording) {
        this.recording.onstop = null;
        this.recording.ondataavailable = null;
        this.recording.onerror = null;
        this.recording = null;
      }
      release();
      if (this.current(generation)) {
        this.busy = false;
        this.ports.error("recording", error);
      }
    }
  }

  /** Only the user's stop action submits recorded audio. */
  stop() {
    if (this.recording?.state !== "inactive") this.recording?.stop();
  }

  /** Cancel this take without disabling the next explicit microphone action. */
  discard() {
    const active = this.active;
    this.cancel();
    this.active = active;
    if (!this.disposed) this.ports.phase("idle");
  }

  private cancel() {
    this.active = false;
    this.generation++;
    this.busy = false;
    this.transcription?.abort();
    this.transcription = null;
    const recording = this.recording;
    this.recording = null;
    if (recording) {
      recording.onstop = null;
      recording.ondataavailable = null;
      recording.onerror = null;
      if (recording.state !== "inactive") recording.stop();
    }
    this.releaseStream?.();
  }

  pause() { this.cancel(); if (!this.disposed) this.ports.phase("idle"); }
  resume() { if (!this.disposed) this.active = true; }
  dispose() { this.disposed = true; this.cancel(); }
}
