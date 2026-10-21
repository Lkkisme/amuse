/**
 * The sidebar's pages, always at its top: the user's things, shown in the
 * sidebar under them. Chats is where it starts. Feeds joins when it is built.
 * (Settings is not one: it sits at the sidebar's bottom and opens its window.)
 */
import { BookOpen, type LucideIcon, MessageCircle, Target } from "lucide-react";
import type { Actions, LeftSection } from "../ui.ts";

export interface NavPage {
  icon: LucideIcon;
  label: string;
  /** whether it is the page the sidebar shows (`left` its section, null for the chats) */
  shown(left: LeftSection | null): boolean;
  open(actions: Actions): void;
}

export const NAV_PAGES: NavPage[] = [
  {
    icon: MessageCircle,
    label: "Chats",
    shown: (left) => left === null,
    open: (actions) => actions.openLeft(null),
  },
  {
    icon: Target,
    label: "Goals",
    shown: (left) => left === "goals",
    open: (actions) => actions.openLeft("goals"),
  },
  { icon: BookOpen, label: "Skills", shown: (left) => left === "skills", open: (actions) => actions.openLeft("skills") },
];
