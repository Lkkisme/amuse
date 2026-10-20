/**
 * UI-only state: which panels are open and what they show. Server state is
 * the conversation (session.ts); this never duplicates it, only ids into it.
 */
import type { Level, SettingsData } from "./demo/settings.ts";

export type SettingsSection = "general" | "connectors" | "permissions" | "secure-store";

export type Theme = "light" | "dark";

export interface Ui {
  theme: Theme;
  chatsOpen: boolean;
  /** the Muse panel (profile and activity): docked on the right, or floating over the chat while the browser has the right */
  museOpen: boolean;
  settings: { open: boolean; section: SettingsSection; connector: string | null };
  /** browser viewer: active tab, and tabs the user closed (every other run is a tab) */
  viewer: { browserId: string | null; closedTabs: string[] } | null;
  /** connection whose pre-connect explainer is open */
  explainer: string | null;
  /** task whose detail sheet is open */
  taskDetail: string | null;
  /** a short message about something that did not work */
  notice: string | null;
}

export const initialUi: Ui = {
  theme: "light",
  chatsOpen: false,
  museOpen: false,
  settings: { open: false, section: "connectors", connector: null },
  viewer: null,
  explainer: null,
  taskDetail: null,
  notice: null,
};

/** Everything a component can ask for: protocol calls and UI changes. */
export interface Actions {
  send(text: string): void;
  stop(): void;
  resolveApproval(id: string, resolution: "allow_once" | "allow_always" | "deny"): void;
  openExplainer(connectionId: string | null): void;
  connect(connectionId: string): void;
  /** null: whichever browser is newest (or none, said so) */
  openViewer(browserId: string | null): void;
  closeViewer(): void;
  selectTab(browserId: string): void;
  closeTab(browserId: string): void;
  control(browserId: string, action: "take" | "handBack" | "stop"): void;
  /** while the user holds it: shape the run's desktop like this view (CSS px) */
  fit(browserId: string, view: { width: number; height: number }): void;
  stopTask(taskId: string): void;
  openTaskDetail(taskId: string | null): void;
  setChats(open: boolean): void;
  setMuse(open: boolean): void;
  openSettings(section: SettingsSection): void;
  closeSettings(): void;
  openConnector(id: string | null): void;
  toggleConnector(id: string): void;
  setCapability(connectorId: string, capabilityId: string, level: Level): void;
  setWebsiteRule(id: string, level: Level): void;
  addCredential(domain: string, username: string): void;
  setTheme(theme: Theme): void;
  reset(): void;
}

export type { SettingsData };
