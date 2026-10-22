/**
 * The sidebar's pages, always at its top: the user's things, shown in the
 * sidebar under them. Chats is where it starts. Feeds joins when it is built.
 * (Settings is not one: it sits at the sidebar's bottom and opens its window.)
 */
import { BookOpen, type LucideIcon, MessageCircle, Target } from "lucide-react";
import type { Actions, LeftSection } from "../ui.ts";
import type { Messages } from "../i18n/en.ts";

export interface NavPage {
  icon: LucideIcon;
  /** the page's name, in the language on screen */
  label: (t: Messages) => string;
  /** whether it is the page the sidebar shows (`left` its section, null for the chats) */
  shown(left: LeftSection | null): boolean;
  open(actions: Actions): void;
}

export const NAV_PAGES: NavPage[] = [
  {
    icon: MessageCircle,
    label: (t) => t.sidebar.pages.chats,
    shown: (left) => left === null,
    open: (actions) => actions.openLeft(null),
  },
  {
    icon: Target,
    label: (t) => t.sidebar.pages.goals,
    shown: (left) => left === "goals",
    open: (actions) => actions.openLeft("goals"),
  },
  {
    icon: BookOpen,
    label: (t) => t.sidebar.pages.skills,
    shown: (left) => left === "skills",
    open: (actions) => actions.openLeft("skills"),
  },
];
