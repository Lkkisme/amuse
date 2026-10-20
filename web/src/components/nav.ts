/**
 * Muse's page navigation, shared by the desktop icon rail and the mobile
 * drawer (Muse mobile has a bottom bar; remuse puts the same pages in the
 * drawer instead, per owner).
 */
import { Lightbulb, MessageCircle, Notebook, Search, Shapes, SquareCheck } from "lucide-react";

export const NAV_PAGES = [
  { icon: MessageCircle, label: "Chat", active: true },
  { icon: Search, label: "Search" },
  { icon: Notebook, label: "Docs" },
  { icon: Lightbulb, label: "Ideas" },
  { icon: SquareCheck, label: "Tasks" },
  { icon: Shapes, label: "Apps" },
] as const;
