/**
 * remuse web app. The conversation is the fold of the session's events;
 * Ui is local panel state; Actions turn clicks into protocol calls or panel
 * changes. Components get exactly the slices they render.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { connect } from "@remuse/api/client";
import { createHost, realTimers } from "@remuse/core";
import { demoPorts, seed } from "@remuse/demo";
import type { Method, Params, Session } from "@remuse/protocol";
import { seedSettings } from "./demo/settings.ts";
import { type Connection, connection } from "./connection.ts";
import { useConversation } from "./session.ts";
import { Unlock } from "./components/Unlock";
import { type Actions, type Ui, initialUi } from "./ui.ts";
import { viewerTabs } from "./view.ts";
import { transition } from "./transition.ts";

const VIEWER_WIDTH = "remuse.viewerWidth";
/** The viewer is at least 420px; the chat keeps at least 360px beside the 56px rail. */
const clampViewer = (width: number) => Math.round(Math.max(420, Math.min(width, innerWidth - 56 - 360)));
import { MusePanel } from "./components/MusePanel";
import { ChatFeed } from "./components/ChatFeed";
import { ChatsPanel } from "./components/ChatsPanel";
import { Composer } from "./components/Composer";
import { ExplainerModal } from "./components/ExplainerModal";
import { IconRail } from "./components/IconRail";
import { SettingsModal } from "./components/SettingsModal";
import { TaskDetailSheet } from "./components/TaskDetailSheet";
import { BrowserButton } from "./components/BrowserButton";
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
  const { state: conversation, older, release } = useConversation(session);
  const [ui, setUi] = useState<Ui>(initialUi);
  const museOpen = useRef(ui.museOpen);
  museOpen.current = ui.museOpen;
  const [settings, setSettings] = useState(seedSettings);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", ui.theme === "dark");
    document.documentElement.classList.toggle("light", ui.theme === "light");
  }, [ui.theme]);

  // desktop: how wide the browser viewer is (its left edge is dragged), kept on this device
  const [viewerWidth, setViewerWidth] = useState(() => clampViewer(Number(localStorage.getItem(VIEWER_WIDTH)) || innerWidth - 482));
  useEffect(() => {
    localStorage.setItem(VIEWER_WIDTH, String(viewerWidth));
    document.documentElement.style.setProperty("--viewer-width", `${viewerWidth}px`); // read by the viewer and the chat beside it
  }, [viewerWidth]);

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
      // the browser takes the right: a docked Muse panel gives it up, and its avatar goes back to the top
      openViewer: (browserId) => {
        const open = () =>
          patch((u) => ({ ...u, museOpen: false, viewer: { browserId, closedTabs: (u.viewer?.closedTabs ?? []).filter((t) => t !== browserId) } }));
        // only a docked Muse panel's avatar has somewhere to travel; otherwise the viewer just slides in
        // (a transition would lift the avatar over the viewer, then drop it at the end)
        if (museOpen.current) transition(open);
        else open();
      },
      closeViewer: () => patch((u) => ({ ...u, viewer: null })),
      selectTab: (browserId) => patch((u) => (u.viewer ? { ...u, viewer: { ...u.viewer, browserId } } : u)),
      closeTab: (browserId) =>
        patch((u) => {
          if (!u.viewer) return u;
          const closedTabs = [...u.viewer.closedTabs, browserId];
          const last = viewerTabs(conversation, closedTabs).at(-1);
          if (!last) return { ...u, viewer: null };
          return { ...u, viewer: { browserId: u.viewer.browserId === browserId ? last.id : u.viewer.browserId, closedTabs } };
        }),
      control: (id, action) => call("browser.control", { id, action }),
      // best effort and quiet: a desktop that keeps its shape still works
      fit: (id, { width, height }) => void session.call("browser.fit", { id, width, height }).catch(() => {}),
      stopTask: (id) => call("task.stop", { id }),
      openTaskDetail: (taskDetail) => patch((u) => ({ ...u, taskDetail })),
      setChats: (chatsOpen) => patch((u) => ({ ...u, chatsOpen })),
      // the avatar travels between the top and the panel
      setMuse: (museOpen) => transition(() => patch((u) => ({ ...u, museOpen }))),
      openSettings: (section) => patch((u) => ({ ...u, chatsOpen: false, settings: { open: true, section, app: null } })),
      openApp: (app) => patch((u) => ({ ...u, settings: { ...u.settings, app } })),
      closeSettings: () => patch((u) => ({ ...u, settings: { ...u.settings, open: false } })),
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
      <IconRail actions={actions} />
      {/* with the viewer open on desktop, the chat keeps what the viewer leaves */}
      <div className={`relative flex min-w-0 flex-1 flex-col ${ui.viewer ? "lg:mr-[var(--viewer-width)]" : ""}`}>
        <ChatFeed conversation={conversation} older={older} release={release} thumb={where.kind === "server" ? where.thumb : null} actions={actions} />
        <TopBar conversation={conversation} museOpen={ui.museOpen} actions={actions} />
        <MenuButton open={ui.chatsOpen} actions={actions} />
        <BrowserButton conversation={conversation} open={ui.viewer !== null} actions={actions} />
        {ui.notice && (
          <p
            role="status"
            className="anim-fade-in absolute inset-x-0 bottom-[86px] z-30 mx-auto w-fit max-w-[90%] rounded-full px-4 py-2 text-[13px]"
            style={{ background: "var(--fill-primary)", color: "var(--fill-red)", boxShadow: "var(--shadow-float)" }}
          >
            {ui.notice}
          </p>
        )}
        <Composer conversation={conversation} actions={actions} />
      </div>

      {ui.museOpen && <MusePanel conversation={conversation} mode={ui.viewer ? "floating" : "docked"} actions={actions} />}
      <ChatsPanel open={ui.chatsOpen} actions={actions} />
      <SettingsModal ui={ui.settings} theme={ui.theme} data={settings} session={session} actions={actions} />
      <ExplainerModal conversation={conversation} open={ui.explainer} actions={actions} />
      <TaskDetailSheet conversation={conversation} open={ui.taskDetail} actions={actions} />
      <Viewer
        conversation={conversation}
        viewer={ui.viewer}
        live={where.kind === "server" ? where.live : null}
        onResize={(edge) => setViewerWidth(clampViewer(innerWidth - edge))}
        actions={actions}
      />
    </div>
  );
}
