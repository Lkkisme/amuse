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

  // Connection request card + explainer modal
  requestConnect(connreqId: string): void;
  confirmConnect(connreqId: string): void;
  dismissConnect(connreqId: string): void;

  // Browser viewer / takeover
  openViewer(browserId: string): void;
  closeViewer(): void;
  takeControl(): void;
  handBack(): void;
  viewerStop(): void;
  viewerDone(): void;

  // Drawer + settings
  setDrawer(open: boolean, view?: "main" | "tasks"): void;
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
