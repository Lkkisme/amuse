/**
 * The sidebar's pages, always at its top: the user's things. Chats (the
 * first, where the sidebar starts) and Goals show in the sidebar under them;
 * Settings opens its dialog. Feeds joins when it is built.
 */
import { type LucideIcon, MessageCircle, Settings, Target } from "lucide-react";
import type { Actions, LeftSection } from "../ui.ts";

export interface NavPage {
  icon: LucideIcon;
  label: string;
  /** whether it is the page the sidebar shows (`left` its section, null for the chats) */
  shown(left: LeftSection | null): boolean;
  open(actions: Actions): void;
}

export const NAV_PAGES: NavPage[] = [
  { icon: MessageCircle, label: "Chats", shown: (left) => left === null, open: (actions) => actions.openLeft(null) },
  { icon: Target, label: "Goals", shown: (left) => left === "goals", open: (actions) => actions.openLeft("goals") },
  {
    icon: Settings,
    label: "Settings",
    shown: () => false,
    open: (actions) => {
      actions.setChats(false);
      actions.openSettings(null);
    },
  },
];
