/**
 * Top chrome: round ☰ menu button top-left (opens the drawer: pages + chats) and the centered
 * Muse avatar with its name badge. While Muse works, the badge grows a status
 * line ("is responding", "Re-observing page", ...).
 */
import { List, Menu, PanelLeftClose, ShieldAlert, Wrench } from "lucide-react";
import type { State } from "@amuse/protocol";
import type { Actions } from "../ui.ts";
import { type AgentLine, agentLine } from "../view.ts";
import { museAvatar } from "../transition.ts";

const LINE_ICONS = { list: List, tool: Wrench, approval: ShieldAlert } as const;

/** The top bar; while the Muse panel is open, the avatar is over there (it travels, see transition.ts). */
export function TopBar({ conversation, museOpen, actions }: { conversation: State; museOpen: boolean; actions: Actions }) {
  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 py-2"
    >
      {/* spacer: the menu button lives outside the header (MenuButton) so it can sit above the drawer */}
      <span className="size-11" />

      {/* The avatar and its badge take the clicks that land on them (the bar around them lets them through).
          Amuse avatar bubble, drawn over the top of its name badge (Amuse: 52px avatar, badge tucked 4px under).
          Its shadow is a layer of its own under the badge, so it falls on the chat, not on the badge. */}
      {!museOpen && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 flex-col items-center">
          <span
            aria-hidden
            className="absolute top-0 size-[52px] rounded-full"
            style={{ boxShadow: "var(--shadow-float)" }}
          />
          <button
            aria-label="Amuse"
            className="pointer-events-auto relative z-[2] flex size-[52px] items-center justify-center rounded-full text-[20px] font-semibold"
            style={{ ...museAvatar, background: "var(--avatar-fill)", color: "var(--avatar-text)" }}
            onClick={() => actions.setMuse(true)}
          >
            A
          </button>
          <AvatarBadge line={agentLine(conversation)} />
        </div>
      )}

    </header>
  );
}

function AvatarBadge({ line }: { line: AgentLine | null }) {
  const Icon = line ? LINE_ICONS[line.icon] : null;
  return (
    <span
      className="pointer-events-auto relative z-[1] -mt-1 flex min-w-[52px] flex-col items-center rounded-[20px] px-3.5 pb-1.5 pt-[5px] transition-all duration-200"
      style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
    >
      <span className="text-[14px] font-semibold leading-[18px]" style={{ color: "var(--text-primary)" }}>
        Amuse
      </span>
      {line && Icon && (
        <span
          key={line.text}
          className="anim-fade-in flex items-center gap-1.5 whitespace-nowrap text-[12.5px] leading-[17px]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Icon size={12} />
          {line.text}
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
/** ☰: docks or collapses the sidebar where there is room for it, else opens or closes it over the chat. */
export function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const icon = "absolute transition-all duration-200 ease-out";
  return (
    <button
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      // fixed to the window, not the chat: docked sidebar or not, it is in the same place to tap again
      className="hover-fade fixed left-3 top-2 z-[45] flex size-11 items-center justify-center rounded-full"
      style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "var(--shadow-float)" }}
      onClick={onToggle}
    >
      <Menu size={20} className={icon} style={{ opacity: open ? 0 : 1, transform: open ? "rotate(90deg) scale(0.6)" : "none" }} />
      <PanelLeftClose
        size={20}
        className={icon}
        style={{ opacity: open ? 1 : 0, transform: open ? "none" : "rotate(-90deg) scale(0.6)" }}
      />
    </button>
  );
}
