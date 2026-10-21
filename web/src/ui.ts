/**
 * UI-only state: which panels are open and what they show. Server state is
 * the conversation (session.ts); this never duplicates it, only ids into it.
 */
import { type App, type Attachment, MAIN } from "@remuse/protocol";
import type { SettingsData } from "./demo/settings.ts";

export type SettingsSection = "general" | "connectors" | "permissions" | "schedules" | "secure-store";

export type Theme = "light" | "dark";

export interface Ui {
  theme: Theme;
  /** the chat on screen: MAIN or a side chat's id */
  chat: string;
  chatsOpen: boolean;
  /** the Muse panel (profile and activity): docked on the right, or floating over the chat while the browser has the right */
  museOpen: boolean;
  /** section null: on a phone, the list of sections (on a desktop, the first one) */
  settings: { open: boolean; section: SettingsSection | null; app: App | null };
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
  chat: MAIN,
  chatsOpen: false,
  museOpen: false,
  settings: { open: false, section: null, app: null },
  viewer: null,
  explainer: null,
  taskDetail: null,
  notice: null,
};

/** Everything a component can ask for: protocol calls and UI changes. */
export interface Actions {
  /** say something in the chat on screen, with any files already uploaded */
  send(text: string, attachments: Attachment[]): void;
  stop(): void;
  /** try again a turn Muse could not reply to */
  retry(failure: string): void;
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
  /** show a chat (the drawer closes) */
  openChat(chat: string): void;
  /** open a new side chat and show it */
  newChat(): void;
  renameChat(chat: string, title: string): void;
  deleteChat(chat: string): void;
  setMuse(open: boolean): void;
  openSettings(section: SettingsSection | null): void;
  /** Settings › Connectors: an app's page, or back to the list (null) */
  openApp(app: App | null): void;
  closeSettings(): void;
  addCredential(domain: string, username: string): void;
  setTheme(theme: Theme): void;
  reset(): void;
}

export type { SettingsData };
