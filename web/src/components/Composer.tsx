/**
 * Composer pill (surface 1): plus, text input, and a send arrow that becomes
 * a stop square while the assistant is "thinking" — driven by the fake timer.
 */
import { useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
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
    <div className="px-4 pb-5 pt-1" style={{ background: "var(--chat-background)" }}>
      <div className="mx-auto max-w-3xl">
        <div
          className="flex items-center gap-2 rounded-full py-2 pl-4 pr-2"
          style={{ background: "var(--fill-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
        >
          <button aria-label="Add attachment" className="shrink-0 rounded-full p-1" style={{ color: "var(--icon-secondary)" }}>
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
          {assistantThinking ? (
            <button
              aria-label="Stop"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: "var(--text-primary)" }}
              onClick={() => actions.stopAssistant()}
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: draft.trim() ? "var(--fill-blue)" : "var(--fill-tertiary)" }}
              onClick={submit}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
