/**
 * Left icon rail (Muse layout): chat, search, doc, lightbulb, checklist,
 * apps grid — settings pinned at the bottom. Narrow, icon-only, hover .18s.
 */
import { Settings } from "lucide-react";
import type { Actions } from "../ui.ts";
import { NAV_PAGES } from "./nav";

export function IconRail({ actions }: { actions: Actions }) {
  return (
    <nav
      className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-3 md:flex"
      style={{
        borderColor: "var(--fill-divider)",
        background: "var(--chat-background)",
      }}
      aria-label="Navigation rail"
    >
      {NAV_PAGES.map(({ icon: Icon, label, active }) => {
        return (
          <button
            key={label}
            aria-label={label}
            title={label}
            className="hover-fade flex size-10 items-center justify-center rounded-xl"
            style={{
              color: active ? "var(--icon-primary)" : "var(--icon-secondary)",
              background: active ? "var(--fill-secondary)" : "transparent",
            }}
          >
            <Icon size={20} />
          </button>
        );
      })}
      <button
        aria-label="Settings"
        title="Settings"
        className="hover-fade mt-auto flex size-10 items-center justify-center rounded-xl"
        style={{ color: "var(--icon-secondary)" }}
        onClick={() => actions.openSettings("general")}
      >
        <Settings size={20} />
      </button>
    </nav>
  );
}
