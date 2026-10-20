/**
 * Composer pill (surface 1): '+' icon left, 'Message' placeholder, mic icon
 * right, and a send arrow that morphs into a dark circle with a small white
 * stop square while the assistant works (border-radius transition ~.2s).
 */
import { useState } from "react";
import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import type { MuseActions } from "./actions";

export function Composer({
  assistantThinking,
  actions,
}: {
  assistantThinking: boolean;
  actions: MuseActions;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text || assistantThinking) return;
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
          className="pointer-events-auto flex items-center gap-2 rounded-full py-2 pl-4 pr-2"
          style={{ background: "var(--fill-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
        >
          <button aria-label="Add attachment" className="hover-fade shrink-0 rounded-full p-1" style={{ color: "var(--icon-secondary)" }}>
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
          <button aria-label="Dictate" className="hover-fade shrink-0 rounded-full p-1" style={{ color: "var(--icon-secondary)" }}>
            <Mic size={19} />
          </button>
          {/* send arrow ⇄ stop square: one button, border-radius/background morph ~.2s */}
          <button
            aria-label={assistantThinking ? "Stop" : "Send"}
            className="flex size-9 shrink-0 items-center justify-center"
            style={{
              borderRadius: "9999px",
              background: assistantThinking
                ? "var(--text-primary)"
                : draft.trim()
                  ? "var(--fill-blue)"
                  : "var(--fill-tertiary)",
              color: "#fff",
              transition: "background-color .2s ease, border-radius .2s ease",
            }}
            onClick={assistantThinking ? () => actions.stopAssistant() : submit}
          >
            {assistantThinking ? (
              <Square size={11} fill="currentColor" strokeWidth={0} />
            ) : (
              <ArrowUp size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
