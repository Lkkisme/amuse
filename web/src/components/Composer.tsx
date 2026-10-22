/**
 * Composer pill (surface 1): '+' icon left, 'Message' placeholder, mic icon
 * right. The trailing button exists only when it has a job: send while there
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
import { ArrowUp, CircleAlert, File as FileIcon, LoaderCircle, Mic, Plus, Square, X } from "lucide-react";
import type { Attachment, State } from "@amuse/protocol";
import { size } from "@amuse/core";
import type { Actions } from "../ui.ts";
import { busy } from "../view.ts";
import { useFiles } from "../files.ts";

/** A file on its way: uploading, up (its attachment), or failed (why). */
interface Pending {
  key: string;
  file: File;
  /** a local preview, for images */
  preview: string | null;
  state: { kind: "uploading" } | { kind: "ready"; attachment: Attachment } | { kind: "failed"; reason: string };
}

/** `place`: a side chat's title, said in the placeholder ("Message in …"); null in the main chat. */
/** One line of the box, and the most it grows to (about seven lines) before it scrolls. */
const LINE = 36;
const MAX_HEIGHT = 166;

export function Composer({ conversation, place, actions }: { conversation: State; place: string | null; actions: Actions }) {
  const working = busy(conversation);
  const files = useFiles();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  /** the box grows with what is written, a line at a time, up to MAX_HEIGHT; past one line the pill becomes a card */
  const box = useRef<HTMLTextAreaElement>(null);
  const [lines, setLines] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    setLines(el.scrollHeight > LINE + 2);
  }, [draft]);
  // previews are let go of with the composer
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  // the mic: recorded here, turned into text on the server (with the user's own key), put in the draft to edit
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceProblem, setVoiceProblem] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  // browsers keep the mic from pages on plain http: there the mic is off, and says why
  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const listen = async () => {
    setVoiceProblem(null);
    if (!secure) return setVoiceProblem("Voice needs Amuse on https (see the README: Other devices).");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setVoiceProblem("The microphone was not allowed.");
    }
    const recording = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recording.ondataavailable = (e) => chunks.push(e.data);
    recording.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setVoice("transcribing");
      const audio = new Blob(chunks, { type: recording.mimeType || "audio/webm" });
      fetch("/transcribe", { method: "POST", headers: { "content-type": audio.type }, body: audio })
        .then(async (response) => {
          const said: unknown = await response.json().catch(() => null);
          const field = (key: string) => (typeof said === "object" && said !== null && key in said ? String(Reflect.get(said, key)) : "");
          if (response.ok && field("text")) setDraft((d) => (d.trim() ? `${d.trim()} ${field("text")}` : field("text")));
          else setVoiceProblem(field("reason") || (response.ok ? "Nothing was heard." : "That could not be turned into text."));
        })
        .catch(() => setVoiceProblem("The server cannot be reached."))
        .finally(() => setVoice("idle"));
    };
    recorder.current = recording;
    recording.start();
    setVoice("recording");
  };
  const stopListening = () => recorder.current?.stop();

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
          className={`pointer-events-auto flex flex-col px-2 py-2 ${pending.length > 0 || voiceProblem || lines ? "rounded-[26px]" : "rounded-full"}`}
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
        >
          {voiceProblem && (
            <p role="alert" className="px-3 pb-1 pt-1 text-[13px]" style={{ color: "var(--fill-red)" }}>
              {voiceProblem}
            </p>
          )}
          {pending.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1.5" aria-label="Files to send">
              {pending.map((p) => (
                <Chip key={p.key} pending={p} onRemove={() => remove(p.key)} />
              ))}
            </div>
          )}
          <div className={`flex min-h-[36px] gap-2 ${lines ? "items-end" : "items-center"}`}>
            {/* end buttons are 36px at an 8px inset: concentric with the pill's 26px-radius ends */}
            {files && (
              <>
                <button
                  aria-label="Add files"
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
              className={`min-w-0 flex-1 resize-none bg-transparent py-[7px] text-[15px] leading-[22px] outline-none ${files ? "" : "pl-3"}`}
              style={{ color: "var(--text-primary)", maxHeight: MAX_HEIGHT }}
              placeholder={place ? `Message in ${place}` : "Message"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                if (!files || e.clipboardData.files.length === 0) return;
                e.preventDefault();
                add(e.clipboardData.files);
              }}
              onKeyDown={(e) => {
                // Enter sends where there is a keyboard of keys (Shift+Enter: a new line); on a phone it is a new line, and the
                // button sends; never while an input method is still choosing the words
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || matchMedia("(hover: none)").matches) return;
                e.preventDefault();
                submit();
              }}
            />
            {files && (
              <button
                aria-label={voice === "recording" ? "Stop dictating" : voice === "transcribing" ? "Turning speech into text" : "Dictate"}
                disabled={voice === "transcribing"}
                aria-disabled={!secure}
                title={secure ? undefined : "Voice needs https"}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${voice === "idle" && secure ? "hover-fade" : ""} ${secure ? "" : "opacity-40"}`}
                style={voice === "recording" ? { background: "var(--fill-red)", color: "#fff" } : { color: "var(--icon-secondary)" }}
                onClick={() => (voice === "recording" ? stopListening() : void listen())}
              >
                {voice === "recording" ? (
                  <Square size={13} fill="currentColor" strokeWidth={0} />
                ) : voice === "transcribing" ? (
                  <LoaderCircle size={19} className="animate-spin" />
                ) : (
                  <Mic size={19} />
                )}
              </button>
            )}
            {trailing && (
              <button
                key={trailing}
                aria-label={trailing === "stop" ? "Stop" : "Send"}
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
        </div>
      </div>
    </div>
  );
}

/** A file waiting to go: a thumbnail for an image, else its name and size; dimmed while uploading, red if it failed. */
function Chip({ pending, onRemove }: { pending: Pending; onRemove: () => void }) {
  const { file, preview, state } = pending;
  const failed = state.kind === "failed";
  return (
    <div
      className={`relative shrink-0 ${state.kind === "uploading" ? "opacity-60" : ""}`}
      title={failed ? state.reason : file.name}
      aria-label={`${file.name}${state.kind === "uploading" ? ", uploading" : failed ? `, ${state.reason}` : ""}`}
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
              {failed ? "Not uploaded" : size(file.size)}
            </span>
          </span>
        </div>
      )}
      {state.kind === "uploading" && <span className="skeleton absolute inset-0 rounded-[14px]" />}
      <button
        aria-label={`Remove ${file.name}`}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full"
        style={{ background: "var(--text-primary)", color: "var(--chat-background)" }}
        onClick={onRemove}
      >
        <X size={12} strokeWidth={3} />
      </button>
    </div>
  );
}
