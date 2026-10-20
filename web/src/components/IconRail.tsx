/**
 * Left icon rail (Muse layout): chat, search, doc, lightbulb, checklist,
 * apps grid — download pinned at the bottom. Narrow, icon-only, hover .18s.
 */
import {
  Download,
  FileText,
  LayoutGrid,
  Lightbulb,
  ListTodo,
  MessageCircle,
  Search,
} from "lucide-react";
import type { MuseActions } from "./actions";

const RAIL_ICONS = [
  { icon: MessageCircle, label: "Chat", active: true },
  { icon: Search, label: "Search" },
  { icon: FileText, label: "Docs" },
  { icon: Lightbulb, label: "Ideas" },
  { icon: ListTodo, label: "Tasks" },
  { icon: LayoutGrid, label: "Apps" },
];

export function IconRail() {
  return (
    <nav
      className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-3 md:flex"
      style={{ borderColor: "var(--fill-divider)", background: "var(--chat-background)" }}
      aria-label="Navigation rail"
    >
      {RAIL_ICONS.map(({ icon: Icon, label, active }) => (
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
      ))}
      <button
        aria-label="Download app"
        title="Download app"
        className="hover-fade mt-auto flex size-10 items-center justify-center rounded-xl"
        style={{ color: "var(--icon-secondary)" }}
      >
        <Download size={20} />
      </button>
    </nav>
  );
}
