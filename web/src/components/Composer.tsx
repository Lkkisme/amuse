/**
 * Composer pill (surface 1): '+' icon left, 'Message' placeholder, mic icon
 * right. The trailing button exists only when it has a job: send while there
 * is a draft, stop while the assistant works; otherwise it is not rendered
 * (Muse shows just the mic).
 */
import { useState } from "react";
import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import type { State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { busy } from "../view.ts";

export function Composer({ conversation, actions }: { conversation: State; actions: Actions }) {
  const working = busy(conversation);
  const [draft, setDraft] = useState("");

  const trailing: "stop" | "send" | null = working ? "stop" : draft.trim() ? "send" : null;

  const submit = () => {
    const text = draft.trim();
    if (!text || working) return;
    actions.send(text);
    setDraft("");
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
          className="pointer-events-auto flex min-h-[52px] items-center gap-2 rounded-full px-2 py-2"
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
        >
          {/* end buttons are 36px at an 8px inset: concentric with the pill's 26px-radius ends */}
          <button aria-label="Add attachment" className="hover-fade flex size-9 shrink-0 items-center justify-center rounded-full" style={{ color: "var(--icon-primary)" }}>
            <Plus size={20} />
          </button>
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
  );
}
