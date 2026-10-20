/**
 * Chats panel ('☰ Chats' pill opens it): search input, Main chat row with
 * timestamp, Side chats + add row, recent chats. Slide-over from the left.
 */
import { MessageCircle, Menu, Plus, Search, Settings, X } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

const RECENT_CHATS = [
  { title: "Aquarium trip research", time: "32m" },
  { title: "Friday dinner reservation", time: "1h" },
  { title: "Tide schedule watch", time: "3h" },
];

export function ChatsPanel({ state, actions }: { state: DemoState; actions: MuseActions }) {
  if (!state.chatsOpen) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="anim-fade-in absolute inset-0 bg-black/30" onClick={() => actions.setChats(false)} />
      <aside
        className="anim-pane-from-right relative flex h-full w-[300px] max-w-[85vw] flex-col p-3"
        style={{ background: "var(--bg-primary)", boxShadow: "4px 0 24px rgba(0,0,0,0.12)" }}
        aria-label="Chats"
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
            <Menu size={18} /> Chats
          </span>
          <button
            aria-label="Close chats"
            className="hover-fade rounded-full p-2"
            style={{ color: "var(--icon-secondary)" }}
            onClick={() => actions.setChats(false)}
          >
            <X size={20} />
          </button>
        </div>

        {/* search */}
        <div
          className="flex h-10 items-center gap-2 rounded-full px-3"
          style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}
        >
          <Search size={16} />
          <input
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Search"
          />
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {/* Main chat */}
          <button
            className="hover-fade flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
            style={{ background: "var(--fill-secondary)" }}
            onClick={() => actions.setChats(false)}
          >
            <MessageCircle size={18} style={{ color: "var(--icon-primary)" }} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
              Main chat
            </span>
            <span className="shrink-0 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              32m
            </span>
          </button>

          {/* Side chats + add */}
          <div className="mt-4 flex items-center justify-between px-3">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              Side chats
            </span>
            <button
              aria-label="New side chat"
              className="hover-fade flex size-6 items-center justify-center rounded-full"
              style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Recent chats */}
          <div className="mt-2 space-y-0.5">
            <p className="px-3 pb-1 text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              Recent
            </p>
            {RECENT_CHATS.map((c) => (
              <button
                key={c.title}
                className="hover-fade flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                onClick={() => actions.setChats(false)}
              >
                <MessageCircle size={17} style={{ color: "var(--icon-secondary)" }} />
                <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: "var(--text-primary)" }}>
                  {c.title}
                </span>
                <span className="shrink-0 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {c.time}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2" style={{ borderTop: "1px solid var(--fill-divider)" }}>
          <button
            className="hover-fade flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium"
            style={{ color: "var(--text-primary)" }}
            onClick={() => {
              actions.setChats(false);
              actions.openSettings("connectors");
            }}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>
      </aside>
    </div>
  );
}
