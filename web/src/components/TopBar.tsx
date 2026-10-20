/**
 * Top chrome of the chat surface: drawer hamburger, Muse avatar bubble,
 * Invite button — plus the fake status pill ("Muse is responding") that
 * appears while the assistant timer runs (surfaces 1 + 6).
 */
import { Loader, Menu, Gift } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

export function TopBar({ state, actions }: { state: DemoState; actions: MuseActions }) {
  return (
    <header className="relative flex items-center justify-between px-3 py-2" style={{ background: "var(--chat-background)" }}>
      <button
        aria-label="Open menu"
        className="flex size-10 items-center justify-center rounded-full"
        style={{ color: "var(--icon-primary)" }}
        onClick={() => actions.setDrawer(true)}
      >
        <Menu size={22} />
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
        className="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold"
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
      >
        <Gift size={16} /> Invite
      </button>
    </header>
  );
}

export function StatusPill({ state }: { state: DemoState }) {
  if (!state.statusPill) return null;
  return (
    <div className="flex justify-center pb-1" style={{ background: "var(--chat-background)" }}>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
        style={{ background: "var(--fill-primary)", color: "var(--text-secondary)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
      >
        <Loader size={12} className="animate-spin" />
        {state.statusPill}
      </span>
    </div>
  );
}
