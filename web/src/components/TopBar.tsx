/**
 * Top chrome: round ☰ menu button top-left (opens the drawer: pages + chats) and the centered
 * Muse avatar with its name badge. While Muse works, the badge grows a status
 * line ("is responding", "Re-observing page", ...).
 */
import { Globe, List, Menu, PanelLeftClose, Wrench } from "lucide-react";
import type { AgentStatus, DemoState } from "../data/fakeMuse";

const STATUS_ICONS = { web: Globe, list: List, tool: Wrench } as const;

function currentStatus(state: DemoState): AgentStatus | null {
  if (state.agentStatus) return state.agentStatus;
  const streaming = state.feed.some((i) => i.role === "agent" && i.streaming);
  return state.assistantThinking || streaming ? { icon: "list", text: "is responding" } : null;
}
import type { MuseActions } from "./actions";

export function TopBar({ state, actions }: { state: DemoState; actions: MuseActions }) {
  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 py-2"
    >
      {/* spacer: the menu button lives outside the header (MenuButton) so it can sit above the drawer */}
      <span className="size-10" />

      {/* Muse avatar bubble */}
      <div className="pointer-events-none absolute left-1/2 top-1 z-10 flex -translate-x-1/2 flex-col items-center">
        <span
          className="flex size-11 items-center justify-center rounded-full text-[17px] font-semibold"
          style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.10)" }}
        >
          M
        </span>
        <AvatarBadge status={currentStatus(state)} />
      </div>

    </header>
  );
}

function AvatarBadge({ status }: { status: AgentStatus | null }) {
  const Icon = status ? STATUS_ICONS[status.icon] : null;
  return (
    <span
      className="-mt-1.5 flex flex-col items-center rounded-full px-2.5 py-0.5 transition-all duration-200"
      style={{ background: "var(--fill-primary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
    >
      <span className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Muse
      </span>
      {status && Icon && (
        <span
          key={status.text}
          className="anim-fade-in flex items-center gap-1 whitespace-nowrap text-[10px]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Icon size={10} />
          {status.text}
        </span>
      )}
    </span>
  );
}

/**
 * The ☰ button. It stays put above the drawer (z-45: over the drawer's z-40,
 * under the viewer's z-50) and morphs into a collapse icon while the drawer
 * is open, so one tap target opens and closes it.
 */
export function MenuButton({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const open = state.chatsOpen;
  const icon = "absolute transition-all duration-200 ease-out";
  return (
    <button
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      className="hover-fade absolute left-3 top-2 z-[45] flex size-10 items-center justify-center rounded-full"
      style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
      onClick={() => actions.setChats(!open)}
    >
      <Menu size={18} className={icon} style={{ opacity: open ? 0 : 1, transform: open ? "rotate(90deg) scale(0.6)" : "none" }} />
      <PanelLeftClose
        size={18}
        className={icon}
        style={{ opacity: open ? 1 : 0, transform: open ? "none" : "rotate(-90deg) scale(0.6)" }}
      />
    </button>
  );
}
