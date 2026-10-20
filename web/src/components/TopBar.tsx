/**
 * Top chrome: '☰ Chats' pill top-left (opens the Chats panel), centered Muse
 * avatar bubble, 'Invite' pill top-right.
 */
import { Menu, Gift } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

export function TopBar({ state, actions }: { state: DemoState; actions: MuseActions }) {
  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 py-2"
    >
      <button
        aria-label="Open chats"
        className="hover-fade pointer-events-auto flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold"
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
        onClick={() => actions.setChats(!state.chatsOpen)}
      >
        <Menu size={16} />
        <span className="hidden sm:inline">Chats</span>
      </button>

      {/* Muse avatar bubble */}
      <div className="pointer-events-none absolute left-1/2 top-1 z-10 flex -translate-x-1/2 flex-col items-center">
        <span
          className="flex size-11 items-center justify-center rounded-full text-[17px] font-semibold"
          style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.10)" }}
        >
          M
        </span>
        <span
          className="-mt-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: "var(--fill-primary)", color: "var(--text-secondary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
        >
          Muse
        </span>
      </div>

      <button
        className="hover-fade pointer-events-auto flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold"
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
      >
        <Gift size={16} /> Invite
      </button>
    </header>
  );
}
