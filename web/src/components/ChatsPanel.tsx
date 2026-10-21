/**
 * The sidebar: the user's things, on the left. The pages at the top (Chats,
 * Goals, Settings; nav.ts), and under them the page shown: the chats (search,
 * the main chat, side chats (+ opens one), most recently used first; a side
 * chat's row renames or deletes it), or the goals (the list, then a goal's
 * page over it).
 *   docked  beside the chat while there is room (☰ collapses it)
 *   drawer  over the chat from the left (☰ opens and closes it): the phone's
 *           drawer; on a desktop without room to dock it, a floating window
 *           like the Muse panel's
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, MoreHorizontal, Plus, Search } from "lucide-react";
import { type Chat, MAIN, type Session } from "@amuse/protocol";
import type { Actions, LeftSection } from "../ui.ts";
import { NAV_PAGES } from "./nav";
import { usePresence } from "./usePresence";
import { Goals } from "./Goals";
import { GoalPage } from "./GoalPage";

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

/** The docked sidebar's width (the drawer's too, up to 85% of a phone). */
export const SIDEBAR_WIDTH = 300;

interface SidebarProps {
  chats: Chat[];
  current: string;
  left: LeftSection | null;
  goal: string | null;
  session: Session;
  actions: Actions;
}

/** Beside the chat, while there is room. */
export function DockedSidebar(props: SidebarProps) {
  return (
    <aside
      className="relative hidden h-full shrink-0 flex-col border-r p-3 md:flex"
      style={{ width: SIDEBAR_WIDTH, background: "var(--chat-background)", borderColor: "var(--fill-divider)" }}
      aria-label="Sidebar"
    >
      <SidebarContent {...props} />
    </aside>
  );
}

/** Over the chat from the left: a phone's drawer, or a desktop's sidebar without room to dock. */
export function DrawerSidebar({ open, ...props }: SidebarProps & { open: boolean }) {
  const { mounted, closing, onAnimationEnd } = usePresence(open);
  if (!mounted) return null;
  return (
    // clips the slide, so the panel comes out from the edge; a tap beside it closes it (dimmed on a phone only)
    <div className={`fixed inset-0 z-40 flex overflow-hidden md:pb-4 md:pl-4 md:pt-[60px] ${closing ? "pointer-events-none" : ""}`}>
      <div className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/30 md:bg-transparent`} onClick={() => props.actions.setChats(false)} />
      <aside
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-pane-to-left pointer-events-none" : "anim-pane-from-left"} relative flex h-full max-w-[85vw] flex-col p-3 md:rounded-[28px]`}
        style={{ width: SIDEBAR_WIDTH, background: "var(--chat-background)", boxShadow: "var(--shadow-drawer)" }}
        aria-label="Sidebar"
      >
        {/* room for the ☰ button (TopBar's MenuButton), which stays put above the drawer (on a desktop, the window opens under it) */}
        <div className="h-11 shrink-0 md:hidden" />
        <SidebarContent {...props} />
      </aside>
    </div>
  );
}

function SidebarContent({ chats, current, left, goal, session, actions }: SidebarProps) {
  return (
    <>
      <nav className="mt-3 grid shrink-0 grid-cols-3 gap-1" aria-label="Pages">
        {NAV_PAGES.map(({ icon: Icon, label, shown, open }) => (
          <button
            key={label}
            aria-current={shown(left) ? "page" : undefined}
            className="hover-fade flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] font-medium"
            style={{
              background: shown(left) ? "var(--fill-secondary)" : "transparent",
              color: shown(left) ? "var(--text-primary)" : "var(--text-secondary)",
            }}
            onClick={() => open(actions)}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
      {left === "goals" ? (
        <>
          <div className="-mx-3 flex min-h-0 flex-1 flex-col">
            <Goals session={session} onOpen={(id) => actions.openGoal(id)} />
          </div>
          {goal !== null && <GoalPage key={goal} session={session} id={goal} onBack={() => actions.openGoal(null)} />}
        </>
      ) : (
        <ChatList chats={chats} current={current} actions={actions} />
      )}
    </>
  );
}

function ChatList({ chats, current, actions }: { chats: Chat[]; current: string; actions: Actions }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const main = chats.find((c) => c.id === MAIN);
  const sides = chats.filter((c) => c.id !== MAIN && (!q || named(c).toLowerCase().includes(q)));
  return (
    <>
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
    </>
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
