/**
 * amuse web app. The conversation is the fold of the session's events;
 * Ui is local panel state; Actions turn clicks into protocol calls or panel
 * changes. Components get exactly the slices they render.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { connect } from "@amuse/api/client";
import { createHost, realTimers } from "@amuse/core";
import { demoPorts, seed } from "@amuse/demo";
import { MAIN, type Method, type Params, type Session } from "@amuse/protocol";
import { type Connection, connection } from "./connection.ts";
import { useChats, useConversation } from "./session.ts";
import { applyTheme, storedTheme } from "./theme.ts";
import { Files, serverFiles } from "./files.ts";
import { Unlock } from "./components/Unlock";
import { type Actions, type Ui, initialUi } from "./ui.ts";
import { viewerTabs } from "./view.ts";
import { type Outgoing, outgoingIn } from "./outgoing.ts";
import { transition } from "./transition.ts";
import { close, useBack } from "./back.ts";

/** the width the user dragged the viewer to (only that is kept; the default follows the window) */
const VIEWER_WIDTH = "amuse.viewerDragged";
/** The viewer is at least 420px; the chat keeps at least 360px beside the 56px rail. */
const clampViewer = (width: number) =>
  Math.round(Math.max(420, Math.min(width, innerWidth - 56 - 360)));
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
const openSession = (
  where: Connection,
): { session: Session; close: () => void } => {
  if (where.kind === "server") {
    const remote = connect(where.rpc);
    return { session: remote, close: () => remote.close() };
  }
  return {
    session: createHost(demoPorts(realTimers), { seed: seed() }),
    close: () => {},
  };
};

export default function App() {
  const [where, setWhere] = useState<Connection | null>(null);
  useEffect(() => void connection().then(setWhere), []);
  if (!where) return null;
  return where.kind === "locked" ? (
    <Unlock ready={where.ready} />
  ) : (
    <Chat where={where} />
  );
}

function Chat({ where }: { where: Exclude<Connection, { kind: "locked" }> }) {
  const [link, setLink] = useState(() => openSession(where));
  const { session } = link;
  const chats = useChats(session);
  // the look this device was left in
  const [ui, setUi] = useState<Ui>(() => ({
    ...initialUi,
    theme: storedTheme(),
  }));
  const {
    state: conversation,
    older,
    release,
  } = useConversation(session, ui.chat);
  /** messages on their way, shown at once (outgoing.ts) */
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const shownOutgoing = useMemo(
    () => outgoingIn(conversation.entities, outgoing, ui.chat),
    [conversation.entities, outgoing, ui.chat],
  );
  /** where files go and come from: the server's (the demo keeps none) */
  const files = useMemo(
    () => (where.kind === "server" ? serverFiles(where.rpc) : null),
    [where],
  );
  // on a server, what is not set up yet (asked again as settings close): with no chat model, the chat
  // says where to choose one; with no apps' key, a Connect card opens the settings where it goes
  const [needsModel, setNeedsModel] = useState(false);
  const [needsAppsKey, setNeedsAppsKey] = useState(false);
  useEffect(() => {
    if (where.kind !== "server" || ui.settings.open) return;
    session.call("keys.list", {}).then(
      (keys) => {
        setNeedsModel(keys.chat === null);
        setNeedsAppsKey(
          keys.providers.some((p) => p.use === "apps" && !p.connected),
        );
      },
      () => {},
    );
  }, [session, where.kind, ui.settings.open]);
  // back from connecting an app (another tab, or Settings): a Connect card still waiting asks how it went
  useEffect(() => {
    if (where.kind !== "server") return;
    const waiting = () =>
      conversationRef.current.entities.some(
        (e) => e.kind === "connection" && e.status === "pending",
      );
    const look = () => {
      if (document.visibilityState === "visible" && waiting())
        session.call("apps.accounts", {}).catch(() => {});
    };
    if (!ui.settings.open) look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, [session, where.kind, ui.settings.open]);
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const needsAppsKeyRef = useRef(needsAppsKey);
  needsAppsKeyRef.current = needsAppsKey;
  /** the chat on screen, for actions made once (sending goes where the user is now) */
  const chatRef = useRef(ui.chat);
  chatRef.current = ui.chat;
  // the chat on screen was deleted (here or on another device): back to the main chat
  useEffect(() => {
    if (chats.length > 0 && !chats.some((c) => c.id === ui.chat))
      setUi((u) => ({ ...u, chat: MAIN, viewer: null }));
  }, [chats, ui.chat]);
  const museOpen = useRef(ui.museOpen);
  museOpen.current = ui.museOpen;

  useEffect(() => applyTheme(ui.theme), [ui.theme]);

  // desktop: how wide the browser viewer is (its left edge is dragged), kept on this device
  const [viewerWidth, setViewerWidth] = useState(() =>
    // first time: at most two thirds of the window, the chat keeping the rest
    clampViewer(
      Number(localStorage.getItem(VIEWER_WIDTH)) ||
        Math.min(innerWidth - 482, (innerWidth * 2) / 3),
    ),
  );
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--viewer-width",
      `${viewerWidth}px`,
    ); // read by the viewer and the chat beside it
  }, [viewerWidth]);

  const actions = useMemo<Actions>(() => {
    const patch = (fn: (u: Ui) => Ui) => setUi(fn);
    /** Every call's failure is shown, briefly; nothing is dropped silently. */
    const call = <M extends Method>(method: M, params: Params[M]) =>
      void session.call(method, params).catch((error: unknown) =>
        patch((u) => ({
          ...u,
          notice: error instanceof Error ? error.message : String(error),
        })),
      );
    return {
      // the device's time zone is the user's: times the agent sets and says are on their clock
      // shown at once as sending; one that does not get through comes off the chat (the composer takes it back)
      send: (text, attachments) => {
        const chat = chatRef.current;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const key = `sending-${crypto.randomUUID()}`;
        setOutgoing((list) => [
          ...list,
          {
            key,
            chat,
            text,
            attachments,
            at: new Date().toISOString(),
            timezone,
            sent: null,
            after: conversationRef.current.entities.at(-1)?.id ?? null,
          },
        ]);
        return session
          .call("chat.send", { chat, text, timezone, attachments })
          .then(
            ({ id }) =>
              setOutgoing((list) =>
                list.map((o) => (o.key === key ? { ...o, sent: id } : o)),
              ),
            (error: unknown) => {
              setOutgoing((list) => list.filter((o) => o.key !== key));
              const reason =
                error instanceof Error ? error.message : String(error);
              patch((u) => ({
                ...u,
                notice:
                  reason === "disconnected"
                    ? "Not sent: Amuse could not be reached. Your message is back in the box."
                    : `Not sent: ${reason}`,
              }));
              throw error;
            },
          );
      },
      stop: () => call("chat.stop", { chat: chatRef.current }),
      retry: (id) => call("chat.retry", { id }),
      resolveApproval: (id, resolution) =>
        call("approval.resolve", { id, resolution }),
      // before apps are set up, a Connect card goes straight to where their key goes
      openExplainer: (explainer) =>
        patch((u) =>
          explainer !== null && needsAppsKeyRef.current
            ? {
                ...u,
                settings: {
                  open: true,
                  section: "connectors",
                  app: null,
                  provider: null,
                },
              }
            : { ...u, explainer },
        ),
      connect: (id) => {
        // apps are not set up yet: the card leads to where their key goes
        if (needsAppsKeyRef.current)
          return patch((u) => ({
            ...u,
            explainer: null,
            settings: {
              open: true,
              section: "connectors",
              app: null,
              provider: null,
            },
          }));
        patch((u) => ({ ...u, explainer: null }));
        // open the tab now, inside the click, so mobile browsers do not block it; point it at the link once known
        const tab = window.open("about:blank", "_blank");
        session.call("connection.begin", { id }).then(
          ({ url }) =>
            tab ? tab.location.replace(url) : window.location.assign(url),
          (error: unknown) => {
            tab?.close();
            patch((u) => ({
              ...u,
              notice: error instanceof Error ? error.message : String(error),
            }));
          },
        );
      },
      // the browser takes the right: a docked Muse panel gives it up, and its avatar goes back to the top
      openViewer: (browserId) => {
        const open = () =>
          patch((u) => ({
            ...u,
            museOpen: false,
            viewer: { browserId },
          }));
        // only a docked Muse panel's avatar has somewhere to travel; otherwise the viewer just slides in
        // (a transition would lift the avatar over the viewer, then drop it at the end)
        if (museOpen.current) transition(open);
        else open();
      },
      closeViewer: () => patch((u) => ({ ...u, viewer: null })),
      selectTab: (browserId) =>
        patch((u) =>
          u.viewer ? { ...u, viewer: { ...u.viewer, browserId } } : u,
        ),
      // closing a tab closes its browser; the viewer moves to another open one, or goes
      closeTab: (browserId) => {
        call("browser.control", { id: browserId, action: "stop" });
        patch((u) => {
          if (!u.viewer) return u;
          const last = viewerTabs(conversation)
            .filter((b) => b.id !== browserId)
            .at(-1);
          // the last one closed: the viewer stays, saying none is open
          if (!last) return { ...u, viewer: { browserId: null } };
          return {
            ...u,
            viewer: {
              browserId:
                u.viewer.browserId === browserId ? last.id : u.viewer.browserId,
            },
          };
        });
      },
      newBrowser: () =>
        void session
          .call("browser.open", {
            chat: chatRef.current,
            url: "https://www.google.com/",
          })
          .then(
            ({ id }) =>
              patch((u) => ({
                ...u,
                museOpen: false,
                viewer: { browserId: id },
              })),
            (error: unknown) =>
              patch((u) => ({
                ...u,
                notice: error instanceof Error ? error.message : String(error),
              })),
          ),
      control: (id, action) => call("browser.control", { id, action }),
      // best effort and quiet: a desktop that keeps its shape still works
      fit: (id, view) =>
        void session.call("browser.fit", { id, view }).catch(() => {}),
      stopTask: (id) => call("task.stop", { id }),
      openTaskDetail: (taskDetail) => patch((u) => ({ ...u, taskDetail })),
      setChats: (chatsOpen) => patch((u) => ({ ...u, chatsOpen })),
      // a chat's browsers are its own: the viewer starts over
      openChat: (chat) =>
        patch((u) => ({ ...u, chat, chatsOpen: false, viewer: null })),
      newChat: () =>
        void session.call("chats.create", {}).then(
          ({ id }) =>
            patch((u) => ({ ...u, chat: id, chatsOpen: false, viewer: null })),
          (error: unknown) =>
            patch((u) => ({
              ...u,
              notice: error instanceof Error ? error.message : String(error),
            })),
        ),
      renameChat: (id, title) => call("chats.rename", { id, title }),
      deleteChat: (id) => {
        call("chats.delete", { id });
        patch((u) => (u.chat === id ? { ...u, chat: MAIN, viewer: null } : u));
      },
      // the avatar travels between the top and the panel
      setMuse: (museOpen) =>
        transition(() => patch((u) => ({ ...u, museOpen }))),
      openSettings: (section) =>
        patch((u) => ({
          ...u,
          chatsOpen: false,
          settings: { open: true, section, app: null, provider: null },
        })),
      openApp: (app) =>
        patch((u) => ({ ...u, settings: { ...u.settings, app } })),
      openProvider: (provider) =>
        patch((u) => ({ ...u, settings: { ...u.settings, provider } })),
      closeSettings: () =>
        patch((u) => ({ ...u, settings: { ...u.settings, open: false } })),
      setTheme: (theme) => patch((u) => ({ ...u, theme })),
      reset: () => {
        link.close();
        setLink(openSession(where));
        setUi((u) => ({ ...initialUi, theme: u.theme }));
      },
    };
  }, [session, link, conversation]);

  // Back closes the top layer; Muse's panel closes as its button does, its avatar travelling home
  useBack(ui, (layer) =>
    layer === "muse" ? actions.setMuse(false) : setUi((u) => close(u, layer)),
  );

  // a notice shows for a few seconds
  useEffect(() => {
    if (!ui.notice) return;
    const timer = setTimeout(
      () => setUi((u) => ({ ...u, notice: null })),
      4000,
    );
    return () => clearTimeout(timer);
  }, [ui.notice]);

  return (
    <Files.Provider value={files}>
      <div
        className="flex h-full"
        style={{ background: "var(--chat-background)" }}
      >
        <IconRail actions={actions} />
        {/* with the viewer open on desktop, the chat keeps what the viewer leaves */}
        <div
          className={`relative flex min-w-0 flex-1 flex-col ${ui.viewer ? "lg:mr-[var(--viewer-width)]" : ""}`}
        >
          <ChatFeed
            conversation={conversation}
            outgoing={shownOutgoing}
            older={older}
            release={release}
            thumb={where.kind === "server" ? where.thumb : null}
            actions={actions}
          />
          <TopBar
            conversation={conversation}
            museOpen={ui.museOpen}
            actions={actions}
          />
          <MenuButton open={ui.chatsOpen} actions={actions} />
          <BrowserButton
            conversation={conversation}
            open={ui.viewer !== null}
            actions={actions}
          />
          {ui.notice && (
            <p
              role="status"
              className="anim-fade-in absolute inset-x-0 bottom-[86px] z-30 mx-auto w-fit max-w-[90%] rounded-full px-4 py-2 text-[13px]"
              style={{
                background: "var(--fill-primary)",
                color: "var(--fill-red)",
                boxShadow: "var(--shadow-float)",
              }}
            >
              {ui.notice}
            </p>
          )}
          {needsModel && !ui.notice && (
            <button
              className="anim-fade-in absolute inset-x-0 bottom-[86px] z-30 mx-auto w-fit max-w-[90%] rounded-full px-4 py-2 text-[13px] font-medium"
              style={{
                background: "var(--fill-primary)",
                color: "var(--fill-blue)",
                boxShadow: "var(--shadow-float)",
              }}
              onClick={() => actions.openSettings("models")}
            >
              Choose a model to start chatting
            </button>
          )}
          <Composer
            conversation={conversation}
            place={
              ui.chat === MAIN
                ? null
                : chats.find((c) => c.id === ui.chat)?.title || "New chat"
            }
            actions={actions}
          />
        </div>

        {ui.museOpen && (
          <MusePanel
            conversation={conversation}
            session={session}
            mode={ui.viewer ? "floating" : "docked"}
            actions={actions}
          />
        )}
        <ChatsPanel
          open={ui.chatsOpen}
          chats={chats}
          current={ui.chat}
          actions={actions}
        />
        <SettingsModal
          ui={ui.settings}
          theme={ui.theme}
          session={session}
          demo={where.kind === "demo"}
          actions={actions}
        />
        <ExplainerModal
          conversation={conversation}
          open={ui.explainer}
          actions={actions}
        />
        <TaskDetailSheet
          conversation={conversation}
          open={ui.taskDetail}
          actions={actions}
        />
        <Viewer
          conversation={conversation}
          viewer={ui.viewer}
          live={where.kind === "server" ? where.live : null}
          thumb={where.kind === "server" ? where.thumb : null}
          onResize={(edge) => {
            const width = clampViewer(innerWidth - edge);
            localStorage.setItem(VIEWER_WIDTH, String(width));
            setViewerWidth(width);
          }}
          actions={actions}
        />
      </div>
    </Files.Provider>
  );
}
