/**
 * UI-only state: which panels are open and what they show. Server state is
 * the conversation (session.ts); this never duplicates it, only ids into it.
 */
import { type App, type Attachment, type KeyProvider, MAIN } from "@amuse/protocol";

export type SettingsSection = "general" | "models" | "connectors" | "permissions" | "logins" | "schedules" | "sandbox";

/** A section of the sidebar besides the chats (nav.ts). */
export type LeftSection = "goals";

import type { Theme } from "./theme.ts";

export type { Theme };

export interface Ui {
  theme: Theme;
  /** the chat on screen: MAIN or a side chat's id */
  chat: string;
  /** the sidebar docked beside the chat, where there is room: the user's choice (☰), kept on this device */
  sidebar: boolean;
  /** the sidebar as a drawer over the chat (a phone; a desktop without room to dock it) */
  chatsOpen: boolean;
  /** what the sidebar shows besides the chats; null: the chats */
  left: LeftSection | null;
  /** the goal whose page is open in the sidebar */
  goal: string | null;
  /** the Muse panel (profile and activity): docked on the right, or floating over the chat while the browser has the right */
  museOpen: boolean;
  /** section null: on a phone, the list of sections (on a desktop, the first one) */
  /** `app`, `provider`: a connector's or a key provider's page, open over its section */
  settings: { open: boolean; section: SettingsSection | null; app: App | null; provider: KeyProvider | null };
  /** browser viewer: active tab, and tabs the user closed (every other run is a tab) */
  viewer: { browserId: string | null } | null;
  /** connection whose pre-connect explainer is open */
  explainer: string | null;
  /** task whose detail sheet is open */
  taskDetail: string | null;
  /** a short message about something that did not work */
  notice: string | null;
}

export const initialUi: Ui = {
  theme: "system",
  chat: MAIN,
  sidebar: true,
  chatsOpen: false,
  left: null,
  goal: null,
  museOpen: false,
  settings: { open: false, section: null, app: null, provider: null },
  viewer: null,
  explainer: null,
  taskDetail: null,
  notice: null,
};

/** Everything a component can ask for: protocol calls and UI changes. */
export interface Actions {
  /** say something in the chat on screen, with any files already uploaded; fails when it did not get through */
  send(text: string, attachments: Attachment[]): Promise<void>;
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
  /** close a browser (its tab): its agent stops, its logins are kept, its place is given up */
  closeTab(browserId: string): void;
  /** open a browser of the user's own, held by them from the start, and show it */
  newBrowser(): void;
  control(browserId: string, action: "take" | "handBack" | "stop"): void;
  /** while a browser is viewed: shape its desktop like this view (CSS px); null: back to the standard size */
  fit(browserId: string, view: { width: number; height: number } | null): void;
  stopTask(taskId: string): void;
  openTaskDetail(taskId: string | null): void;
  setChats(open: boolean): void;
  /** dock the sidebar or collapse it (where there is room for it) */
  setSidebar(docked: boolean): void;
  /** show a section in the sidebar (null: the chats) */
  openLeft(section: LeftSection | null): void;
  /** open a goal's page in the sidebar (null: back to the list) */
  openGoal(goal: string | null): void;
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
  openProvider(provider: KeyProvider | null): void;
  closeSettings(): void;
  setTheme(theme: Theme): void;
  reset(): void;
}

