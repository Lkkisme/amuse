/**
 * Composer pill (surface 1): '+' icon left, 'Message' placeholder, mic icon
 * right. The trailing button exists only when it has a job: send while there
 * is a draft, stop while the assistant works; otherwise it is not rendered
 * (Muse shows just the mic).
 *
 * '+' (or pasting) adds files: each uploads at once and waits above the input
 * (images as thumbnails) until the message goes; it goes once every file is
 * up. Where no server keeps files (the demo) there is no '+'.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleAlert, File as FileIcon, Mic, Plus, Square, X } from "lucide-react";
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
export function Composer({ conversation, place, actions }: { conversation: State; place: string | null; actions: Actions }) {
  const working = busy(conversation);
  const files = useFiles();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  // previews are let go of with the composer
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const ready = pending.flatMap((p) => (p.state.kind === "ready" ? [p.state.attachment] : []));
  const uploading = pending.some((p) => p.state.kind === "uploading");
  const sendable = !uploading && (draft.trim() !== "" || ready.length > 0);
  const trailing: "stop" | "send" | null = working ? "stop" : sendable ? "send" : null;

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
    if (!sendable || working) return;
    actions.send(draft.trim(), ready);
    setDraft("");
    pending.forEach((p) => remove(p.key)); // a failed file goes too: it was not sent
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/* content scrolls under the composer and dissolves into the gradient */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28"
        style={{ background: "linear-gradient(to top, var(--chat-background) 55%, transparent)" }}
      />
      <div className="relative mx-auto max-w-3xl px-4 pb-5 pt-1">
        <div
          className={`pointer-events-auto flex flex-col px-2 py-2 ${pending.length > 0 ? "rounded-[26px]" : "rounded-full"}`}
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
        >
          {pending.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1.5" aria-label="Files to send">
              {pending.map((p) => (
                <Chip key={p.key} pending={p} onRemove={() => remove(p.key)} />
              ))}
            </div>
          )}
          <div className="flex min-h-[36px] items-center gap-2">
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
            <input
              className={`min-w-0 flex-1 bg-transparent text-[15px] outline-none ${files ? "" : "pl-3"}`}
              style={{ color: "var(--text-primary)" }}
              placeholder={place ? `Message in ${place}` : "Message"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                if (!files || e.clipboardData.files.length === 0) return;
                e.preventDefault();
                add(e.clipboardData.files);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button aria-label="Dictate" className="hover-fade flex size-9 shrink-0 items-center justify-center rounded-full" style={{ color: "var(--icon-secondary)" }}>
              <Mic size={19} />
            </button>
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
