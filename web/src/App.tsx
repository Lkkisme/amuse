/**
 * remuse web app. The conversation is the fold of the session's events;
 * Ui is local panel state; Actions turn clicks into protocol calls or panel
 * changes. Components get exactly the slices they render.
 */
import { useEffect, useMemo, useState } from "react";
import { createHost, demoPorts, realTimers, seed } from "@remuse/core";
import { seedSettings } from "./demo/settings.ts";
import { useConversation } from "./session.ts";
import { type Actions, type Ui, initialUi } from "./ui.ts";
import { browsers } from "./view.ts";
import { ActivityPanel } from "./components/ActivityPanel";
import { ChatFeed } from "./components/ChatFeed";
import { ChatsPanel } from "./components/ChatsPanel";
import { Composer } from "./components/Composer";
import { ExplainerModal } from "./components/ExplainerModal";
import { IconRail } from "./components/IconRail";
import { SettingsModal } from "./components/SettingsModal";
import { TaskDetailSheet } from "./components/TaskDetailSheet";
import { TaskPill } from "./components/TaskPill";
import { MenuButton, TopBar } from "./components/TopBar";
import { Viewer } from "./components/Viewer";

/** The in-browser host: the real core with scripted ports. A WebSocket session replaces it as is. */
const demoSession = () => createHost(demoPorts(realTimers), { seed: seed() });

export default function App() {
  const [session, setSession] = useState(demoSession);
  const conversation = useConversation(session);
  const [ui, setUi] = useState<Ui>(initialUi);
  const [settings, setSettings] = useState(seedSettings);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", ui.theme === "dark");
    document.documentElement.classList.toggle("light", ui.theme === "light");
  }, [ui.theme]);

  // Muse opens the activity panel when the agent starts working.
  const working = conversation.activity !== null;
  useEffect(() => {
    if (working) setUi((u) => ({ ...u, activityOpen: true }));
  }, [working]);

  const actions = useMemo<Actions>(() => {
    const patch = (fn: (u: Ui) => Ui) => setUi(fn);
    return {
      send: (text) => void session.call("chat.send", { text }),
      stop: () => void session.call("chat.stop", {}),
      resolveApproval: (id, resolution) => void session.call("approval.resolve", { id, resolution }),
      openExplainer: (explainer) => patch((u) => ({ ...u, explainer })),
      connect: (id) => {
        patch((u) => ({ ...u, explainer: null }));
        void session.call("connection.begin", { id });
      },
      openViewer: (browserId) =>
        patch((u) => ({ ...u, viewer: { browserId, closedTabs: (u.viewer?.closedTabs ?? []).filter((t) => t !== browserId) } })),
      closeViewer: () => patch((u) => ({ ...u, viewer: null })),
      selectTab: (browserId) => patch((u) => (u.viewer ? { ...u, viewer: { ...u.viewer, browserId } } : u)),
      closeTab: (browserId) =>
        patch((u) => {
          if (!u.viewer) return u;
          const closedTabs = [...u.viewer.closedTabs, browserId];
          const last = browsers(conversation)
            .map((b) => b.id)
            .filter((id) => !closedTabs.includes(id))
            .at(-1);
          if (!last) return { ...u, viewer: null };
          return { ...u, viewer: { browserId: u.viewer.browserId === browserId ? last : u.viewer.browserId, closedTabs } };
        }),
      control: (id, action) => void session.call("browser.control", { id, action }),
      stopTask: (id) => void session.call("task.stop", { id }),
      openTaskDetail: (taskDetail) => patch((u) => ({ ...u, taskDetail })),
      setChats: (chatsOpen) => patch((u) => ({ ...u, chatsOpen })),
      setActivity: (activityOpen) => patch((u) => ({ ...u, activityOpen })),
      openSettings: (section) => patch((u) => ({ ...u, chatsOpen: false, settings: { open: true, section, connector: null } })),
      closeSettings: () => patch((u) => ({ ...u, settings: { ...u.settings, open: false, connector: null } })),
      openConnector: (connector) => patch((u) => ({ ...u, settings: { ...u.settings, connector } })),
      toggleConnector: (id) =>
        setSettings((s) => ({ ...s, connectors: s.connectors.map((c) => (c.id === id ? { ...c, connected: !c.connected } : c)) })),
      setCapability: (connectorId, capabilityId, level) =>
        setSettings((s) => ({
          ...s,
          connectors: s.connectors.map((c) =>
            c.id === connectorId ? { ...c, capabilities: c.capabilities.map((cap) => (cap.id === capabilityId ? { ...cap, level } : cap)) } : c,
          ),
        })),
      setWebsiteRule: (id, level) =>
        setSettings((s) => ({ ...s, websiteRules: s.websiteRules.map((r) => (r.id === id ? { ...r, level } : r)) })),
      addCredential: (domain, username) =>
        setSettings((s) => ({ ...s, credentials: [...s.credentials, { id: `cred${s.credentials.length + 1}`, domain, username }] })),
      setTheme: (theme) => patch((u) => ({ ...u, theme })),
      reset: () => {
        setSession(demoSession());
        setUi((u) => ({ ...initialUi, theme: u.theme }));
        setSettings(seedSettings());
      },
    };
  }, [session, conversation]);

  return (
    <div className="flex h-full" style={{ background: "var(--chat-background)" }}>
      <IconRail />
      {/* with the viewer open on desktop, the chat keeps the left 482px (Muse layout) */}
      <div className={`relative flex min-w-0 flex-1 flex-col ${ui.viewer ? "lg:max-w-[410px]" : ""}`}>
        <ChatFeed conversation={conversation} actions={actions} />
        <TopBar conversation={conversation} />
        <MenuButton open={ui.chatsOpen} actions={actions} />
        <TaskPill conversation={conversation} actions={actions} />
        <Composer conversation={conversation} actions={actions} />
      </div>

      <ActivityPanel conversation={conversation} open={ui.activityOpen} actions={actions} />
      <ChatsPanel open={ui.chatsOpen} actions={actions} />
      <SettingsModal ui={ui.settings} theme={ui.theme} data={settings} actions={actions} />
      <ExplainerModal conversation={conversation} open={ui.explainer} actions={actions} />
      <TaskDetailSheet conversation={conversation} open={ui.taskDetail} actions={actions} />
      <Viewer conversation={conversation} viewer={ui.viewer} actions={actions} />
    </div>
  );
}
