/**
 * Left drawer, toggled by the ☰ button, which stays above it and turns into a
 * collapse icon: page grid on mobile, then the chat search box right above the
 * list it filters: the main chat, then side chats (+ opens one), most recently
 * used first. A side chat can be renamed or deleted from its row. Slide-over
 * from the left.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, MoreHorizontal, Plus, Search, Settings } from "lucide-react";
import { type Chat, MAIN } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { NAV_PAGES } from "./nav";
import { usePresence } from "./usePresence";

/** How long ago, in a few characters: now, 5m, 3h, 2d, then the date. */
function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const named = (chat: Chat) => (chat.id === MAIN ? "Main chat" : chat.title || "New chat");

export function ChatsPanel({ open, chats, current, actions }: { open: boolean; chats: Chat[]; current: string; actions: Actions }) {
  const [query, setQuery] = useState("");
  const { mounted, closing, onAnimationEnd } = usePresence(open);
  if (!mounted) return null;
  const q = query.trim().toLowerCase();
  const main = chats.find((c) => c.id === MAIN);
  const sides = chats.filter((c) => c.id !== MAIN && (!q || named(c).toLowerCase().includes(q)));
  // on md+ the drawer opens beside the icon rail (w-14), so the ☰ button lines up with its padding
  return (
    // starts right of the rail (md up) and clips the slide, so the panel comes out from under the rail, never over it
    <div className={`fixed inset-0 z-40 flex overflow-hidden md:left-14 ${closing ? "pointer-events-none" : ""}`}>
      <div className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/30`} onClick={() => actions.setChats(false)} />
      <aside
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-pane-to-left pointer-events-none" : "anim-pane-from-left"} relative flex h-full w-[300px] max-w-[85vw] flex-col p-3`}
        style={{ background: "var(--chat-background)", boxShadow: "var(--shadow-drawer)" }}
        aria-label="Menu"
      >
        {/* room for the ☰ button (TopBar's MenuButton), which stays put above the drawer */}
        <div className="h-10 shrink-0" />

        {/* pages: the rail is hidden below md, so the drawer carries them, Settings last */}
        <nav className="mt-3 grid grid-cols-3 gap-1 md:hidden" aria-label="Pages">
          {NAV_PAGES.map(({ icon: Icon, label, active }) => (
            <button
              key={label}
              className="hover-fade flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] font-medium"
              style={{ background: active ? "var(--fill-secondary)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
              onClick={() => actions.setChats(false)}
            >
              <Icon size={20} />
              {label}
            </button>
          ))}
          <button
            className="hover-fade flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] font-medium"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => {
              actions.setChats(false);
              actions.openSettings(null);
            }}
          >
            <Settings size={20} />
            Settings
          </button>
        </nav>

        {/* search sits on the list it filters */}
        <div className="mt-3 flex h-10 shrink-0 items-center gap-2 rounded-full px-3" style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}>
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
          {main && (
            <Row chat={main} current={current === MAIN} actions={actions} main />
          )}

          {/* Side chats + add */}
          <div className="mt-4 flex items-center justify-between px-3">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              Side chats
            </span>
            <button
              aria-label="New side chat"
              className="hover-fade flex size-6 items-center justify-center rounded-full"
              style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
              onClick={actions.newChat}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="mt-2 space-y-0.5">
            {sides.length === 0 && (
              <p className="px-3 py-2 text-[14px]" style={{ color: "var(--text-secondary)" }}>
                {q ? `No chats match "${query}"` : "None yet. A side chat keeps a topic apart from the main chat."}
              </p>
            )}
            {sides.map((c) => (
              <Row key={c.id} chat={c} current={current === c.id} actions={actions} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** One chat in the list: opens it; a side chat's row also renames or deletes it (from its … menu). */
function Row({ chat, current, actions, main = false }: { chat: Chat; current: boolean; actions: Actions; main?: boolean }) {
  const [mode, setMode] = useState<"idle" | "menu" | "rename" | "delete">("idle");
  const [title, setTitle] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode === "rename") input.current?.select();
  }, [mode]);
  const rename = () => {
    const next = title.trim();
    if (next && next !== chat.title) actions.renameChat(chat.id, next);
    setMode("idle");
  };

  if (mode === "rename")
    return (
      <div className="flex items-center gap-3 rounded-xl px-3 py-1.5" style={{ background: "var(--fill-secondary)" }}>
        <MessageCircle size={17} style={{ color: "var(--icon-secondary)" }} />
        <input
          ref={input}
          aria-label="Chat name"
          className="min-w-0 flex-1 bg-transparent py-1 text-[14px] outline-none"
          style={{ color: "var(--text-primary)" }}
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") rename();
            if (e.key === "Escape") setMode("idle");
          }}
        />
      </div>
    );

  return (
    <div className="group relative">
      <button
        className="hover-fade flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
        style={{ background: current ? "var(--fill-secondary)" : "transparent" }}
        aria-current={current ? "page" : undefined}
        onClick={() => actions.openChat(chat.id)}
      >
        <MessageCircle size={main ? 18 : 17} style={{ color: main ? "var(--icon-primary)" : "var(--icon-secondary)" }} />
        <span className={`min-w-0 flex-1 truncate ${main ? "text-[15px] font-medium" : "text-[14px]"}`} style={{ color: "var(--text-primary)" }}>
          {named(chat)}
        </span>
        <span className={`shrink-0 text-[12px] ${main ? "" : "group-hover:invisible max-sm:invisible"}`} style={{ color: "var(--text-secondary)" }}>
          {ago(chat.updated)}
        </span>
      </button>
      {!main && (
        <button
          aria-label={`Options for ${named(chat)}`}
          className="hover-fade absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full opacity-0 focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
          style={{ color: "var(--icon-secondary)", background: "var(--chat-background)" }}
          onClick={() => setMode(mode === "menu" ? "idle" : "menu")}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
      {(mode === "menu" || mode === "delete") && (
        <div
          role="menu"
          className="anim-popover-in absolute right-2 top-full z-10 mt-1 w-48 overflow-hidden rounded-2xl p-1"
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
        >
          {mode === "menu" ? (
            <>
              <MenuItem
                onClick={() => {
                  setTitle(chat.title);
                  setMode("rename");
                }}
              >
                Rename
              </MenuItem>
              <MenuItem danger onClick={() => setMode("delete")}>
                Delete
              </MenuItem>
            </>
          ) : (
            <>
              <p className="px-3 pb-1 pt-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                Delete this chat for good? Anything still running in it stops.
              </p>
              <MenuItem
                danger
                onClick={() => {
                  setMode("idle");
                  actions.deleteChat(chat.id);
                }}
              >
                Delete
              </MenuItem>
              <MenuItem onClick={() => setMode("idle")}>Cancel</MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, danger = false, onClick }: { children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      className="hover-fade block w-full rounded-xl px-3 py-2 text-left text-[14px]"
      style={{ color: danger ? "var(--fill-red)" : "var(--text-primary)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
