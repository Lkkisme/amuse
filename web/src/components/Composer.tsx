/**
 * Composer pill (surface 1): '+' icon left, 'Message' placeholder, mic icon
 * right. While the mic records, the text row is a level meter with the time, a
 * Cancel (✕: throws the take away) and a round stop button. The trailing button exists only when it has a job: send while there
 * is a draft (also while the assistant works: the message reaches it as it
 * goes), stop while it works and there is none; otherwise it is not rendered
 * (Muse shows just the mic).
 *
 * The mic records what the user says; the server turns it into text (their
 * own speech service key), which goes into the draft to edit before sending.
 *
 * '+' (or pasting) adds files: each uploads at once and waits above the input
 * (images as thumbnails) until the message goes; it goes once every file is
 * up. Where no server keeps files (the demo) there is no '+'.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, CircleAlert, File as FileIcon, LoaderCircle, Mic, MicOff, Plus, Square, X } from "lucide-react";
import type { Attachment, Quote, State } from "@amuse/protocol";
import { size } from "@amuse/core";
import type { Actions } from "../ui.ts";
import { busy } from "../view.ts";
import { useFiles } from "../files.ts";
import { useT } from "../i18n/react.ts";
import { askLine, quoteLine } from "../reply.ts";
import { detailOf } from "../ask.tsx";
import { BARS, SAMPLE_MS, clock, level, push, rms, silentAtStart, smooth } from "../level.ts";
import { Button } from "./Button.tsx";
import { VoiceMeter, type Meter } from "./VoiceMeter.tsx";

/** A file on its way: uploading, up (its attachment), or failed (why). */
interface Pending {
  key: string;
  file: File;
  /** a local preview, for images */
  preview: string | null;
  state: { kind: "uploading" } | { kind: "ready"; attachment: Attachment } | { kind: "failed"; reason: string };
}

/** `place`: a side chat's title, said in the placeholder ("Message in …"); null in the main chat. `replying`: the item of Amuse's the message answers, shown above the input. */
/** One line of the box, and the most it grows to (about seven lines) before it scrolls. */
const LINE = 36;
const MAX_HEIGHT = 166;

export function Composer({ conversation, replying, place, actions }: { conversation: State; replying: Quote | null; place: string | null; actions: Actions }) {
  const t = useT();
  const working = busy(conversation);
  const asking = replying?.kind === "error";
  const files = useFiles();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  /** the box grows with what is written, a line at a time, up to MAX_HEIGHT; past one line the pill becomes a card */
  const box = useRef<HTMLTextAreaElement>(null);
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const [lines, setLines] = useState(false);
  /** past its height, the box fades at the end where more is written (above, below) */
  const [more, setMore] = useState({ above: false, below: false });
  const look = () => {
    const el = box.current;
    if (!el) return;
    // within its padding of an end is at it (scrolling to the caret leaves the padding out)
    const above = el.scrollTop > 12;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 12;
    setMore((m) => (m.above === above && m.below === below ? m : { above, below }));
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    setLines(el.scrollHeight > LINE + 2);
    look();
  }, [draft, voice]);
  const fade = `linear-gradient(to bottom, ${more.above ? "transparent 0, #000 20px" : "#000 0"}, ${more.below ? "#000 calc(100% - 20px), transparent 100%" : "#000 100%"})`;
  // replying to something: the box is ready for the words
  useEffect(() => {
    if (replying) box.current?.focus();
  }, [replying?.id]);
  // previews are let go of with the composer
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  // the mic: recorded here, turned into text on the server (with the user's own key), put in the draft to edit
  const recording = useRef<{ done: () => void; cancel: () => void } | null>(null);
  const meter = useRef<Meter>({ bars: [], at: 0 }).current;
  const [time, setTime] = useState("0:00");
  const [quiet, setQuiet] = useState(false);
  // leaving the page lets go of the mic and drops the take
  useEffect(() => () => recording.current?.cancel(), []);
  // Escape throws the take away, or stops turning it into text
  useEffect(() => {
    if (voice === "idle") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && recording.current?.cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voice]);
  // browsers keep the mic from pages on plain http: there the mic is off, and says why
  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const listen = async () => {
    if (!secure) return actions.notify(t.chat.voiceNeedsHttpsHelp);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return actions.notify(t.chat.micNotAllowed);
    }
    // the mic is let go of however the take ends: done, cancelled, failed, or the page left
    let context: AudioContext | null = null;
    let sampler = 0;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearInterval(sampler);
      stream.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      release();
      return actions.notify(t.chat.notTranscribed, { detail: detailOf("voice transcription", "transcription provider", "recorder_unsupported"), retry: () => void listen() });
    }
    let analyser: AnalyserNode | null = null;
    try {
      context = new AudioContext();
      void context.resume();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null; // no meter, but the recording goes on
    }
    let discarded = false;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onerror = () => {
      discarded = true;
      release();
      actions.notify(t.chat.notTranscribed, { detail: detailOf("voice transcription", "transcription provider", "recorder_error"), retry: () => void listen() });
    };
    recorder.onstop = () => {
      release();
      recording.current = null;
      if (discarded) return setVoice("idle");
      setVoice("transcribing");
      // a slow speech service can be given up on: ✕ stops waiting and keeps nothing
      const waiting = new AbortController();
      const turning = {
        done: () => {},
        cancel: () => {
          waiting.abort();
          setVoice("idle");
        },
      };
      recording.current = turning;
      const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      fetch("/transcribe", { method: "POST", headers: { "content-type": audio.type }, body: audio, signal: waiting.signal })
        .then(async (response) => {
          const said: unknown = await response.json().catch(() => null);
          const field = (key: string) => (typeof said === "object" && said !== null && key in said ? String(Reflect.get(said, key)) : "");
          if (response.ok && field("text")) setDraft((d) => (d.trim() ? `${d.trim()} ${field("text")}` : field("text")));
          else {
            const summary = field("reason") || (response.ok ? t.chat.nothingHeard : t.chat.notTranscribed);
            actions.notify(summary, { detail: detailOf("voice transcription", "transcription provider", `transcribe_http_${response.status}`), retry: () => void listen() });
          }
        })
        .catch(() => {
          if (!waiting.signal.aborted) actions.notify(t.common.serverUnreachable);
        })
        .finally(() => {
          if (recording.current === turning) recording.current = null;
          setVoice("idle");
        });
    };
    const stopRecorder = () => {
      if (recorder.state === "inactive") return;
      recorder.stop();
    };
    recording.current = {
      done: stopRecorder,
      cancel: () => {
        discarded = true;
        if (recorder.state === "inactive") {
          release();
          setVoice("idle");
        } else stopRecorder();
      },
    };

    // a level about every 50 ms into the meter, and the clock and the silence check with it
    const began = performance.now();
    const samples = new Float32Array(analyser?.fftSize ?? 0);
    let peak = 0;
    let shown = 0;
    meter.bars = new Array<number>(BARS).fill(0);
    meter.at = began;
    setTime(clock(0));
    setQuiet(false);
    sampler = window.setInterval(() => {
      const now = performance.now();
      if (analyser) {
        analyser.getFloatTimeDomainData(samples);
        const heard = level(rms(samples));
        peak = Math.max(peak, heard);
        shown = smooth(shown, heard);
        meter.bars = push(meter.bars, shown);
        meter.at = now;
      }
      setTime(clock(now - began));
      setQuiet(analyser !== null && silentAtStart(peak, now - began));
    }, SAMPLE_MS);
    recorder.start();
    setVoice("recording");
  };

  const ready = pending.flatMap((p) => (p.state.kind === "ready" ? [p.state.attachment] : []));
  const uploading = pending.some((p) => p.state.kind === "uploading");
  const sendable = !uploading && (draft.trim() !== "" || ready.length > 0);
  const trailing: "stop" | "send" | null = sendable ? "send" : working ? "stop" : null;

  const add = (chosen: Iterable<File>) => {
    if (!files) return;
    for (const file of chosen) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (preview) previews.current.add(preview);
      setPending((list) => [...list, { key, file, preview, state: { kind: "uploading" } }]);
      const settle = (state: Pending["state"]) => setPending((list) => list.map((p) => (p.key === key ? { ...p, state } : p)));
      files.upload(file).then(
        (attachment) => settle({ kind: "ready", attachment }),
        (error: unknown) => settle({ kind: "failed", reason: error instanceof Error ? error.message : String(error) }),
      );
    }
  };
  const remove = (key: string) =>
    setPending((list) => {
      const gone = list.find((p) => p.key === key);
      if (gone?.preview) {
        URL.revokeObjectURL(gone.preview);
        previews.current.delete(gone.preview);
      }
      return list.filter((p) => p.key !== key);
    });

  // asking Amuse about an error: the line is ready (words of the user's own stay), and the box is theirs to add to
  useEffect(() => {
    if (!asking) return;
    setDraft((d) => askLine(d, t.chat.askPrefill));
    const el = box.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [asking, replying?.id, t]);

  const submit = () => {
    if (!sendable) return;
    const text = draft.trim();
    const sent = pending.filter((p) => p.state.kind === "ready");
    setDraft("");
    pending.filter((p) => p.state.kind !== "ready").forEach((p) => remove(p.key)); // a failed file goes: it was not sent
    // the sent files leave the box but keep their previews until the message is through: one that is not comes back
    setPending((list) => list.filter((p) => !sent.includes(p)));
    actions.send(text, ready).then(
      () => sent.forEach((p) => p.preview && (URL.revokeObjectURL(p.preview), previews.current.delete(p.preview))),
      () => {
        setDraft((now) => (now.trim() ? `${text}\n${now}` : text));
        setPending((list) => [...sent, ...list]);
      },
    );
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/* content scrolls under the composer and dissolves into the gradient; the chat's scrollbar is left clear */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-28"
        style={{ right: "var(--chat-scrollbar, 0px)", background: "linear-gradient(to top, var(--chat-background) 55%, transparent)" }}
      />
      <div className="relative mx-auto max-w-3xl px-4 pb-5 pt-1">
        <div
          className={`pointer-events-auto flex flex-col px-2 py-2 ${pending.length > 0 || (lines && voice === "idle") || replying || (quiet && voice === "recording") ? "rounded-[26px]" : "rounded-full"}`}
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
        >
          {replying && (
            <div className="mb-1.5 flex items-center gap-2 pl-3 pr-1 pt-1">
              <span className="w-[3px] self-stretch rounded-full" style={{ background: asking ? "var(--icon-secondary)" : "var(--fill-blue)" }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold" style={{ color: asking ? "var(--text-secondary)" : "var(--fill-blue)" }}>
                  {asking ? t.chat.askingAboutError : replying.kind === "prompt" ? t.chat.replying : t.chat.replyingToAmuse}
                </span>
                <span className="block truncate text-[13px] leading-[18px]" style={{ color: "var(--text-secondary)" }}>
                  {quoteLine(replying, t)}
                </span>
              </span>
              <button
                aria-label={t.chat.cancelReply}
                className="hover-fade flex size-8 shrink-0 items-center justify-center rounded-full"
                style={{ color: "var(--icon-secondary)" }}
                onClick={() => actions.reply(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {pending.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1.5" aria-label={t.chat.filesToSend}>
              {pending.map((p) => (
                <Chip key={p.key} pending={p} onRemove={() => remove(p.key)} />
              ))}
            </div>
          )}
          {voice !== "idle" ? (
            <>
              {quiet && voice === "recording" && (
                <div role="status" className="flex items-center gap-2 px-3 pb-1 pt-1.5 text-[13px] leading-[18px]" style={{ color: "var(--text-secondary)" }}>
                  <MicOff size={15} className="shrink-0" />
                  {t.chat.cantHearYou}
                </div>
              )}
              <div className="flex min-h-[44px] items-center gap-2 sm:min-h-[36px]">
                <button
                  aria-label={t.chat.cancelDictating}
                  className="hover-fade flex size-11 shrink-0 items-center justify-center rounded-full sm:size-9"
                  style={{ color: "var(--icon-secondary)" }}
                  onClick={() => recording.current?.cancel()}
                >
                  <X size={20} />
                </button>
                <span className="min-w-[2.5rem] shrink-0 text-[15px] tabular-nums" style={{ color: voice === "recording" ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                  {time}
                </span>
                <VoiceMeter meter={meter} frozen={voice === "transcribing"} />
                {voice === "recording" ? (
                  // the same round blue button as send and stop: stop recording, then turn it into text
                  <button
                    aria-label={t.chat.doneDictating}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--fill-blue)", color: "#fff" }}
                    onClick={() => recording.current?.done()}
                  >
                    <Square size={14} fill="currentColor" strokeWidth={0} />
                  </button>
                ) : (
                  // the same button, turning while the take becomes text
                  <span
                    role="status"
                    aria-label={t.chat.turningIntoTextLine}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--fill-blue)", color: "#fff" }}
                  >
                    <LoaderCircle size={18} className="animate-spin" />
                  </span>
                )}
              </div>
            </>
          ) : (
          <div className={`flex min-h-[36px] gap-2 ${lines ? "items-end" : "items-center"}`}>
            {/* end buttons are 36px at an 8px inset: concentric with the pill's 26px-radius ends */}
            {files && (
              <>
                <button
                  aria-label={t.chat.addFiles}
                  className="hover-fade flex size-9 shrink-0 items-center justify-center rounded-full"
                  style={{ color: "var(--icon-primary)" }}
                  onClick={() => picker.current?.click()}
                >
                  <Plus size={20} />
                </button>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    add(e.target.files ?? []);
                    e.target.value = ""; // the same file can be picked again
                  }}
                />
              </>
            )}
            <textarea
              ref={box}
              rows={1}
              className={`touch-no-scrollbar min-w-0 flex-1 resize-none bg-transparent py-[7px] text-[15px] leading-[22px] outline-none ${files ? "" : "pl-3"}`}
              style={{ color: "var(--text-primary)", maxHeight: MAX_HEIGHT, maskImage: fade, WebkitMaskImage: fade }}
              onScroll={look}
              placeholder={place ? t.chat.messageIn(place) : t.chat.message}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                if (!files || e.clipboardData.files.length === 0) return;
                e.preventDefault();
                add(e.clipboardData.files);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && replying) return actions.reply(null);
                // Enter sends where there is a keyboard of keys (Shift+Enter: a new line); on a phone it is a new line, and the
                // button sends; never while an input method is still choosing the words
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || matchMedia("(hover: none)").matches) return;
                e.preventDefault();
                submit();
              }}
            />
            {files && (
              <button
                aria-label={t.chat.dictate}
                aria-disabled={!secure}
                title={secure ? undefined : t.chat.voiceNeedsHttps}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${secure ? "hover-fade" : "opacity-40"}`}
                style={{ color: "var(--icon-secondary)" }}
                onClick={() => void listen()}
              >
                <Mic size={19} />
              </button>
            )}
            {trailing && (
              <button
                key={trailing}
                aria-label={trailing === "stop" ? t.chat.stop : t.chat.send}
                className="anim-popover-in flex size-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "var(--fill-blue)",
                  color: "#fff",
                  transformOrigin: "center",
                }}
                onClick={trailing === "stop" ? actions.stop : submit}
              >
                {trailing === "stop" ? <Square size={14} fill="currentColor" strokeWidth={0} /> : <ArrowUp size={18} />}
              </button>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A file waiting to go: a thumbnail for an image, else its name and size; dimmed while uploading, red if it failed. */
function Chip({ pending, onRemove }: { pending: Pending; onRemove: () => void }) {
  const t = useT();
  const { file, preview, state } = pending;
  const failed = state.kind === "failed";
  return (
    <div
      className={`relative shrink-0 ${state.kind === "uploading" ? "opacity-60" : ""}`}
      title={failed ? state.reason : file.name}
      aria-label={`${file.name}${state.kind === "uploading" ? t.chat.uploadingSuffix : failed ? `, ${state.reason}` : ""}`}
    >
      {preview ? (
        <img src={preview} alt="" className="size-14 rounded-[14px] object-cover" style={failed ? { outline: "2px solid var(--fill-red)" } : undefined} />
      ) : (
        <div
          className="flex h-14 max-w-[200px] items-center gap-2 rounded-[14px] px-3"
          style={{ background: "var(--fill-secondary)", outline: failed ? "2px solid var(--fill-red)" : undefined }}
        >
          {failed ? <CircleAlert size={18} style={{ color: "var(--fill-red)" }} /> : <FileIcon size={18} style={{ color: "var(--icon-secondary)" }} />}
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
              {file.name}
            </span>
            <span className="block text-[12px]" style={{ color: failed ? "var(--fill-red)" : "var(--text-secondary)" }}>
              {failed ? t.chat.notUploaded : size(file.size)}
            </span>
          </span>
        </div>
      )}
      {state.kind === "uploading" && <span className="skeleton absolute inset-0 rounded-[14px]" />}
      <button
        aria-label={t.chat.removeFile(file.name)}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full"
        style={{ background: "var(--text-primary)", color: "var(--chat-background)" }}
        onClick={onRemove}
      >
        <X size={12} strokeWidth={3} />
      </button>
    </div>
  );
}
