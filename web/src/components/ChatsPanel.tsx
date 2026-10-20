/**
 * Left drawer, toggled by the ☰ button, which stays above it and turns into a collapse icon: page grid on mobile, then the
 * chat search box right above the list it filters (Main chat, Side chats +
 * add, recent chats). Slide-over from the left.
 */
import { useState } from "react";
import { MessageCircle, Plus, Search, Settings } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import type { MuseActions } from "./actions";
import { NAV_PAGES } from "./nav";
import { usePresence } from "./usePresence";

const RECENT_CHATS = [
  { title: "Aquarium trip research", time: "32m" },
  { title: "Friday dinner reservation", time: "1h" },
  { title: "Tide schedule watch", time: "3h" },
];

export function ChatsPanel({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const [query, setQuery] = useState("");
  const { mounted, closing, onAnimationEnd } = usePresence(state.chatsOpen);
  if (!mounted) return null;
  const q = query.trim().toLowerCase();
  const recent = q ? RECENT_CHATS.filter((c) => c.title.toLowerCase().includes(q)) : RECENT_CHATS;
  // on md+ the drawer opens beside the icon rail (w-14), so the ☰ button lines up with its padding
  return (
    <div className={`fixed inset-0 z-40 flex md:left-14 ${closing ? "pointer-events-none" : ""}`}>
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/30`}
        onClick={() => actions.setChats(false)}
      />
      <aside
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-pane-to-left pointer-events-none" : "anim-pane-from-left"} relative flex h-full w-[300px] max-w-[85vw] flex-col p-3`}
        style={{ background: "var(--chat-background)", boxShadow: "4px 0 24px rgba(0,0,0,0.12)" }}
        aria-label="Menu"
      >
        {/* room for the ☰ button (TopBar's MenuButton), which stays put above the drawer */}
        <div className="h-10 shrink-0" />

        {/* pages: the rail is hidden below md, so the drawer carries them. Search is
            the chat search below, so its tile gives way to Settings at the end. */}
        <nav className="mt-3 grid grid-cols-3 gap-1 md:hidden" aria-label="Pages">
          {NAV_PAGES.filter((p) => p.label !== "Search").map(({ icon: Icon, label, ...rest }) => {
            const active = "active" in rest;
            return (
              <button
                key={label}
                className="hover-fade flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] font-medium"
                style={{
                  background: active ? "var(--fill-secondary)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                }}
                onClick={() => actions.setChats(false)}
              >
                <Icon size={20} />
                {label}
              </button>
            );
          })}
          <button
            className="hover-fade flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] font-medium"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => {
              actions.setChats(false);
              actions.openSettings("connectors");
            }}
          >
            <Settings size={20} />
            Settings
          </button>
        </nav>

        {/* search sits on the list it filters */}
        <div
          className="mt-3 flex h-10 shrink-0 items-center gap-2 rounded-full px-3"
          style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}
        >
          <Search size={16} />
          <input
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
            {recent.length === 0 && (
              <p className="px-3 py-2 text-[14px]" style={{ color: "var(--text-secondary)" }}>
                No chats match "{query}"
              </p>
            )}
            {recent.map((c) => (
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
      </aside>
    </div>
  );
}
