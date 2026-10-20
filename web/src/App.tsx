/**
 * remuse web app. The conversation is the fold of the session's events;
 * Ui is local panel state; Actions turn clicks into protocol calls or panel
 * changes. Components get exactly the slices they render.
 */
import { useEffect, useMemo, useState } from "react";
import { connect } from "@remuse/api/client";
import { createHost, realTimers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import type { Method, Params, Session } from "@remuse/protocol";
import { seedSettings } from "./demo/settings.ts";
import { type Connection, connection } from "./connection.ts";
import { useConversation } from "./session.ts";
import { Unlock } from "./components/Unlock";
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

/** A session and how to let go of it (a socket must be closed, or it reconnects forever). */
const openSession = (where: Connection): { session: Session; close: () => void } => {
  if (where.kind === "server") {
    const remote = connect(where.rpc);
    return { session: remote, close: () => remote.close() };
  }
  return { session: createHost(demoPorts(realTimers), { seed: seed() }), close: () => {} };
};

export default function App() {
  const [where, setWhere] = useState<Connection | null>(null);
  useEffect(() => void connection().then(setWhere), []);
  if (!where) return null;
  return where.kind === "locked" ? <Unlock /> : <Chat where={where} />;
}

function Chat({ where }: { where: Exclude<Connection, { kind: "locked" }> }) {
  const [link, setLink] = useState(() => openSession(where));
  const { session } = link;
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
    /** Every call's failure is shown, briefly; nothing is dropped silently. */
    const call = <M extends Method>(method: M, params: Params[M]) =>
      void session.call(method, params).catch((error: unknown) => patch((u) => ({ ...u, notice: error instanceof Error ? error.message : String(error) })));
    return {
      send: (text) => call("chat.send", { text }),
      stop: () => call("chat.stop", {}),
      resolveApproval: (id, resolution) => call("approval.resolve", { id, resolution }),
      openExplainer: (explainer) => patch((u) => ({ ...u, explainer })),
      connect: (id) => {
        patch((u) => ({ ...u, explainer: null }));
        // open the tab now, inside the click, so mobile browsers do not block it; point it at the link once known
        const tab = window.open("about:blank", "_blank");
        session.call("connection.begin", { id }).then(
          ({ url }) => (tab ? tab.location.replace(url) : window.location.assign(url)),
          (error: unknown) => {
            tab?.close();
            patch((u) => ({ ...u, notice: error instanceof Error ? error.message : String(error) }));
          },
        );
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
      control: (id, action) => call("browser.control", { id, action }),
      stopTask: (id) => call("task.stop", { id }),
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
        link.close();
        setLink(openSession(where));
        setUi((u) => ({ ...initialUi, theme: u.theme }));
        setSettings(seedSettings());
      },
    };
  }, [session, link, conversation]);

  // a notice shows for a few seconds
  useEffect(() => {
    if (!ui.notice) return;
    const timer = setTimeout(() => setUi((u) => ({ ...u, notice: null })), 4000);
    return () => clearTimeout(timer);
  }, [ui.notice]);

  return (
    <div className="flex h-full" style={{ background: "var(--chat-background)" }}>
      <IconRail />
      {/* with the viewer open on desktop, the chat keeps the left 482px (Muse layout) */}
      <div className={`relative flex min-w-0 flex-1 flex-col ${ui.viewer ? "lg:max-w-[410px]" : ""}`}>
        <ChatFeed conversation={conversation} thumb={where.kind === "server" ? where.thumb : null} actions={actions} />
        <TopBar conversation={conversation} />
        <MenuButton open={ui.chatsOpen} actions={actions} />
        <TaskPill conversation={conversation} actions={actions} />
        {ui.notice && (
          <p
            role="status"
            className="anim-fade-in absolute inset-x-0 bottom-[86px] z-30 mx-auto w-fit max-w-[90%] rounded-full px-4 py-2 text-[13px]"
            style={{ background: "var(--fill-primary)", color: "var(--fill-red)", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
          >
            {ui.notice}
          </p>
        )}
        <Composer conversation={conversation} actions={actions} />
      </div>

      <ActivityPanel conversation={conversation} open={ui.activityOpen} actions={actions} />
      <ChatsPanel open={ui.chatsOpen} actions={actions} />
      <SettingsModal ui={ui.settings} theme={ui.theme} data={settings} actions={actions} />
      <ExplainerModal conversation={conversation} open={ui.explainer} actions={actions} />
      <TaskDetailSheet conversation={conversation} open={ui.taskDetail} actions={actions} />
      <Viewer conversation={conversation} viewer={ui.viewer} live={where.kind === "server" ? where.live : null} actions={actions} />
    </div>
  );
}
