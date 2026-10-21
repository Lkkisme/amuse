/**
 * Muse's page navigation, shared by the desktop icon rail and the mobile
 * drawer (Muse mobile has a bottom bar; amuse puts the same pages in the
 * drawer instead, per owner). Only pages that exist are listed; Muse's
 * others (Search, Docs, Ideas, Tasks, Apps) join as they are built.
 */
import { type LucideIcon, MessageCircle } from "lucide-react";

export interface NavPage {
  icon: LucideIcon;
  label: string;
  active: boolean;
}

export const NAV_PAGES: NavPage[] = [
  { icon: MessageCircle, label: "Chat", active: true },
];
