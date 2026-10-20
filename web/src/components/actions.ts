import type { Level } from "../data/fakeMuse";

/**
 * Every visible interaction is expressed here and implemented on fake state
 * in App.tsx. No component reaches outside the local machine.
 */
export interface MuseActions {
  // Chat feed
  send(text: string): void;
  stopAssistant(): void;
  submitTaskForm(taskId: string, values: Record<string, string>): void;
  resolveApproval(id: string, approved: boolean): void;
  openTaskDetail(taskId: string | null): void;

  // Connection request card + explainer modal
  requestConnect(connreqId: string): void;
  confirmConnect(connreqId: string): void;
  dismissConnect(connreqId: string): void;

  // Browser viewer / takeover
  openViewer(browserId: string): void;
  closeViewer(): void;
  selectViewerTab(browserId: string): void;
  closeViewerTab(browserId: string): void;
  takeControl(browserId: string): void;
  /** Done: hand the browser back to the agent, which re-observes and finishes */
  handBack(browserId: string): void;
  viewerStop(browserId: string): void;

  // Chats panel + activity panel
  setChats(open: boolean): void;
  setActivity(open: boolean): void;
  openSettings(section: "general" | "connectors" | "permissions" | "secure-store"): void;
  closeSettings(): void;
  openConnectorDetail(id: string | null): void;
  toggleConnector(id: string): void;
  setCapabilityLevel(connectorId: string, capabilityId: string, level: Level): void;
  setWebsiteRuleLevel(id: string, level: Level): void;
  addCredential(domain: string, username: string): void;

  // Global
  resetDemo(): void;
  setTheme(theme: "light" | "dark"): void;
}

export type SettingsSection = "general" | "connectors" | "permissions" | "secure-store";
