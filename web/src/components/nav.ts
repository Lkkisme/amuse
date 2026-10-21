/**
 * The sidebar's pages, at its top: the user's things. Goals opens inside the
 * sidebar; Settings opens its dialog. Feeds joins when it is built.
 */
import { type LucideIcon, Settings, Target } from "lucide-react";
import type { Actions, LeftSection } from "../ui.ts";

export interface NavPage {
  icon: LucideIcon;
  label: string;
  /** the sidebar section it shows; null: it opens elsewhere */
  section: LeftSection | null;
  open(actions: Actions): void;
}

export const NAV_PAGES: NavPage[] = [
  {
    icon: Target,
    label: "Goals",
    section: "goals",
    open: (actions) => actions.openLeft("goals"),
  },
  {
    icon: Settings,
    label: "Settings",
    section: null,
    open: (actions) => {
      actions.setChats(false);
      actions.openSettings(null);
    },
  },
];
