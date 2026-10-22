/**
 * The sidebar: the user's things, on the left, a rounded panel. The pages at
 * the top (Chats, Goals; nav.ts), Settings at the bottom (it opens its own
 * window), and between them the page shown: the chats (search,
 * the main chat, side chats (+ opens one), most recently used first; a side
 * chat's row renames or deletes it), or the goals (the list, then a goal's
 * page over it).
 *   docked  beside the chat while there is room (☰ collapses it)
 *   drawer  over the chat from the left (☰ opens and closes it): a page of
 *           its own on a phone; on a desktop without room to dock it, a
 *           floating window like the Muse panel's
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, MoreHorizontal, Plus, Search, Settings } from "lucide-react";
import { type Chat, MAIN, type Session, type SkillOrigin } from "@amuse/protocol";
import type { Actions, LeftSection } from "../ui.ts";
import { NAV_PAGES } from "./nav";
import { usePresence } from "./usePresence";
import { Goals } from "./Goals";
import { GoalPage } from "./GoalPage";
import { SkillPage, Skills } from "./Skills";
import { useT } from "../i18n/react.ts";
import { type Language, activeLanguage, activeLocale, catalogOf } from "../i18n/language.ts";
import type { Messages } from "../i18n/en.ts";

/** How long ago, in a few characters: now, 5m, 3h, 2d, then the date. */
function ago(iso: string, now = Date.now(), language: Language = activeLanguage()): string {
  const t = catalogOf(language).sidebar.ago;
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t.now;
  if (minutes < 60) return t.minutes(minutes);
  if (minutes < 24 * 60) return t.hours(Math.floor(minutes / 60));
  if (minutes < 7 * 24 * 60) return t.days(Math.floor(minutes / (24 * 60)));
  return new Date(iso).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" });
}

const named = (chat: Chat, t: Messages) => (chat.id === MAIN ? t.sidebar.mainChat : chat.title || t.chat.newChat);

/** The sidebar's width, the same whatever page it shows. */
export const SIDEBAR_WIDTH = 320;
/** The sidebar is a panel this far in from the window's edges. */
export const SIDEBAR_INSET = 8;
/** what the sidebar takes of the window when docked */
export const SIDEBAR_ROOM = SIDEBAR_WIDTH + SIDEBAR_INSET;

/** The panel, docked or floating: the same shape in the same place, set off by its colour and shadow (a deeper one over the dimmed chat). */
const panel = { background: "var(--panel)", boxShadow: "var(--shadow-panel)" };
const ease = "0.24s cubic-bezier(0.2, 0, 0, 1)";

interface SidebarProps {
  chats: Chat[];
  current: string;
  left: LeftSection | null;
  goal: string | null;
  skill: { name: string; origin: SkillOrigin } | null;
  session: Session;
  actions: Actions;
}

/** Beside the chat, while there is room: a rounded panel that slides in and out whole, the chat giving way as it goes. */
export function DockedSidebar({ open, ...props }: SidebarProps & { open: boolean }) {
  const width = SIDEBAR_WIDTH;
  return (
    <aside
      className="relative hidden h-full shrink-0 md:block"
      style={{
        width: open ? width + SIDEBAR_INSET : 0,
        // hidden (out of the tab order) once it has closed, shown at once as it opens
        visibility: open ? "visible" : "hidden",
        transition: `width ${ease}, visibility 0s linear ${open ? "0s" : "0.24s"}`,
      }}
      aria-label="Sidebar"
    >
      {/* the room for it grows or shrinks; the panel itself moves in and out in one piece */}
      <div
        className="absolute z-[41] flex flex-col overflow-hidden rounded-[24px] p-3"
        style={{
          ...panel,
          top: SIDEBAR_INSET,
          bottom: SIDEBAR_INSET,
          left: SIDEBAR_INSET,
          width,
          transform: open ? "none" : `translateX(calc(-100% - ${2 * SIDEBAR_INSET}px))`,
          transition: `width ${ease}, transform ${ease}`,
        }}
      >
        {/* room for ☰, which moves into the top right while the sidebar is out (TopBar's MenuButton) */}
        <div className="h-11 shrink-0" />
        <SidebarContent {...props} />
      </div>
    </aside>
  );
}

/** Over the chat from the left: a page of its own on a phone, or, on a desktop without room to dock it, the same panel floating. */
export function DrawerSidebar({ open, ...props }: SidebarProps & { open: boolean }) {
  const { mounted, closing, onAnimationEnd } = usePresence(open);
  if (!mounted) return null;
  return (
    // clips the slide, so the panel comes out from the edge; a tap beside it closes it. What it dims is the
    // chat, not the browser beside it
    <div className={`fixed inset-0 z-40 flex overflow-hidden md:p-2 ${closing ? "pointer-events-none" : ""}`}>
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-y-0 left-0 bg-black/30`}
        style={{ right: "var(--viewer-room)" }}
        onClick={() => props.actions.setChats(false)}
      />
      <aside
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-pane-to-left pointer-events-none" : "anim-pane-from-left"} relative flex h-full w-full flex-col bg-[var(--chat-background)] p-3 md:w-[320px] md:rounded-[24px] md:bg-[var(--panel)] md:shadow-[var(--shadow-drawer)]`}
        aria-label="Sidebar"
      >
        {/* room for ☰, which moves into the top right while the sidebar is out (TopBar's MenuButton) */}
        <div className="h-11 shrink-0" />
        <SidebarContent {...props} />
      </aside>
    </div>
  );
}

function SidebarContent({ chats, current, left, goal, skill, session, actions }: SidebarProps) {
  const t = useT();
  return (
    <>
      <nav className="mt-3 grid shrink-0 grid-cols-3 gap-1" aria-label={t.sidebar.pagesLabel}>
        {NAV_PAGES.map(({ icon: Icon, label, shown, open }) => (
          <button
            key={label(t)}
            aria-current={shown(left) ? "page" : undefined}
            className="hover-fade flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] font-medium"
            style={{
              background: shown(left) ? "var(--fill-secondary)" : "transparent",
              color: shown(left) ? "var(--text-primary)" : "var(--text-secondary)",
            }}
            onClick={() => open(actions)}
          >
            <Icon size={20} />
            {label(t)}
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
      ) : left === "skills" ? (
        <>
          <div className="-mx-3 flex min-h-0 flex-1 flex-col">
            <Skills session={session} actions={actions} onOpen={(name, origin) => actions.openSkill({ name, origin })} />
          </div>
          {skill !== null && (
            <SkillPage
              key={`${skill.origin}:${skill.name}`}
              session={session}
              name={skill.name}
              origin={skill.origin}
              onBack={() => actions.openSkill(null)}
            />
          )}
        </>
      ) : (
        <ChatList chats={chats} current={current} actions={actions} />
      )}
      {/* at the bottom, apart from the pages: it is not one, it opens its own window */}
      <button
        className="hover-fade mt-2 flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium"
        style={{ color: "var(--text-primary)" }}
        onClick={() => {
          actions.setChats(false);
          actions.openSettings(null);
        }}
      >
        <Settings size={18} style={{ color: "var(--icon-secondary)" }} />
        {t.settings.title}
      </button>
    </>
  );
}

function ChatList({ chats, current, actions }: { chats: Chat[]; current: string; actions: Actions }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const main = chats.find((c) => c.id === MAIN);
  const sides = chats.filter((c) => c.id !== MAIN && (!q || named(c, t).toLowerCase().includes(q)));
  return (
    <>
      {/* search sits on the list it filters */}
      <div className="mt-3 flex h-10 shrink-0 items-center gap-2 rounded-full px-3" style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}>
        <Search size={16} />
        <input
          className="w-full bg-transparent text-[14px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder={t.sidebar.searchChats}
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
            {t.sidebar.sideChats}
          </span>
          <button
            aria-label={t.sidebar.newSideChat}
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
              {q ? t.sidebar.noMatch(query) : t.sidebar.noSideChats}
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
  const t = useT();
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
          aria-label={t.sidebar.chatName}
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
          {named(chat, t)}
        </span>
        <span className={`shrink-0 text-[12px] ${main ? "" : "group-hover:invisible max-sm:invisible"}`} style={{ color: "var(--text-secondary)" }}>
          {ago(chat.updated)}
        </span>
      </button>
      {!main && (
        <button
          aria-label={t.sidebar.optionsFor(named(chat, t))}
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
                {t.sidebar.rename}
              </MenuItem>
              <MenuItem danger onClick={() => setMode("delete")}>
                {t.common.remove}
              </MenuItem>
            </>
          ) : (
            <>
              <p className="px-3 pb-1 pt-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {t.sidebar.deleteHelp}
              </p>
              <MenuItem
                danger
                onClick={() => {
                  setMode("idle");
                  actions.deleteChat(chat.id);
                }}
              >
                {t.sidebar.delete}
              </MenuItem>
              <MenuItem onClick={() => setMode("idle")}>{t.common.cancel}</MenuItem>
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
