/**
 * remuse web app — one page, local fake state only (docs/ui-spec.md).
 * App owns the single DemoState and implements every MuseAction against it.
 * No network, no backend: all "live" behavior is scripted timers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserRun, DemoState, FeedItem, Level, Task } from "./data/fakeMuse";
import { seedDemo, updateCard } from "./data/fakeMuse";
import type { MuseActions } from "./components/actions";
import { ChatFeed } from "./components/ChatFeed";
import { Composer } from "./components/Composer";
import { ChatsPanel } from "./components/ChatsPanel";
import { IconRail } from "./components/IconRail";
import { ActivityPanel } from "./components/ActivityPanel";
import { MenuButton, TopBar } from "./components/TopBar";
import { SettingsModal } from "./components/SettingsModal";
import { ExplainerModal } from "./components/ExplainerModal";
import { Viewer } from "./components/Viewer";
import { TaskPill } from "./components/TaskPill";
import { TaskDetailSheet } from "./components/TaskDetailSheet";

let idSeq = 100;
const nextId = (prefix: string) => `${prefix}${idSeq++}`;
const nowLabel = () =>
  new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function App() {
  const [state, setState] = useState<DemoState>(seedDemo);
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const patchFeed = useCallback((fn: (feed: FeedItem[]) => FeedItem[]) => {
    setState((s) => ({ ...s, feed: fn(s.feed) }));
  }, []);

  const patchTask = useCallback(
    (taskId: string, fn: (t: Task) => Task) => patchFeed((feed) => updateCard(feed, "task", taskId, fn)),
    [patchFeed],
  );

  const patchBrowser = useCallback(
    (browserId: string, patch: Partial<BrowserRun>) =>
      patchFeed((feed) => updateCard(feed, "browser", browserId, (b) => ({ ...b, ...patch }))),
    [patchFeed],
  );

  /** Stream an agent reply: chunked word-by-word with the shimmer treatment. */
  const streamAgentReply = useCallback(
    (full: string) => {
      const id = nextId("m");
      const time = nowLabel();
      patchFeed((feed) => [...feed, { id, role: "agent", text: "", time, streaming: true }]);
      const words = full.split(" ");
      const step = (i: number) => {
        later(() => {
          patchFeed((feed) =>
            feed.map((m) => (m.role === "agent" && m.id === id ? { ...m, text: words.slice(0, i + 1).join(" ") } : m)),
          );
          if (i + 1 < words.length) {
            step(i + 1);
          } else {
            later(() => {
              patchFeed((feed) => feed.map((m) => (m.role === "agent" && m.id === id ? { ...m, streaming: false } : m)));
              setState((s) => ({ ...s, assistantThinking: false, activityStatus: "connected" }));
            }, 80);
          }
        }, i === 0 ? 0 : 70);
      };
      step(0);
    },
    [later, patchFeed],
  );

  const actions = useMemo<MuseActions>(
    () => ({
      send(text) {
        if (!text.trim()) return;
        patchFeed((feed) => [...feed, { id: nextId("m"), role: "user", text, time: nowLabel() }]);
        setState((s) => ({ ...s, assistantThinking: true, activityStatus: "working", activityOpen: true }));
        later(() => {
          setState((s) => ({ ...s, assistantThinking: false }));
          streamAgentReply(
            `Got it — **"${text}"**. I'll take that from here. A few things I'll do:\n- Open the source and pull the details\n- Draft the result for your review\n\nYou can watch progress in the **activity panel**.`,
          );
        }, 1600);
      },

      stopAssistant() {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setState((s) => ({ ...s, assistantThinking: false, agentStatus: null, activityStatus: "connected" }));
        patchFeed((feed) => feed.map((m) => (m.role === "agent" && m.streaming ? { ...m, streaming: false } : m)));
      },

      openTaskDetail(taskId) {
        setState((s) => ({ ...s, taskDetail: taskId }));
      },

      resolveApproval(id, approved) {
        patchFeed((feed) => updateCard(feed, "approval", id, (a) => ({ ...a, status: approved ? ("approved" as const) : ("denied" as const) })));
        later(() => {
          streamAgentReply(approved ? "Approved — **sending it now**." : "Understood, I dropped the draft.");
        }, 500);
      },

      submitTaskForm(taskId, values) {
        patchTask(taskId, (t) => ({
          ...t,
          status: "working",
          form: t.form?.map((f) => ({ ...f, value: values[f.field] ?? f.value })),
        }));
        setState((s) => ({ ...s, activityStatus: "working", activityOpen: true }));
        // fake the remaining steps completing one by one
        [900, 1700, 2500].forEach((delay) => {
          later(() => {
            patchTask(taskId, (t) => {
              const next = t.steps.findIndex((s) => !s.done);
              if (next === -1) return t;
              const steps = t.steps.map((s, i) => (i === next ? { ...s, done: true } : s));
              return { ...t, steps, status: steps.every((s) => s.done) ? "completed" : "working" };
            });
          }, delay);
        });
        later(() => {
          patchTask(taskId, (t) => ({ ...t, steps: t.steps.map((s) => ({ ...s, done: true })), status: "completed" }));
          setState((s) => ({ ...s, activityStatus: "connected" }));
          streamAgentReply("Thanks — answers noted and the task is **complete**.");
        }, 3400);
      },

      requestConnect(connreqId) {
        patchFeed((feed) => updateCard(feed, "connreq", connreqId, (c) => ({ ...c, status: "explaining" as const })));
        setState((s) => ({ ...s, explainerFor: connreqId }));
      },

      confirmConnect(connreqId) {
        setState((s) => ({ ...s, explainerFor: null }));
        patchFeed((feed) => updateCard(feed, "connreq", connreqId, (c) => ({ ...c, status: "connected" as const })));
        later(() => {
          streamAgentReply("**Connected.** I can read from it now — want me to pull a sample?");
        }, 500);
      },

      dismissConnect(connreqId) {
        setState((s) => ({ ...s, explainerFor: null }));
        patchFeed((feed) => updateCard(feed, "connreq", connreqId, (c) => ({ ...c, status: "pending" as const })));
      },

      openViewer(browserId) {
        setState((s) => ({
          ...s,
          viewer: { browserId, closedTabs: (s.viewer?.closedTabs ?? []).filter((id) => id !== browserId) },
        }));
      },
      closeViewer() {
        setState((s) => ({ ...s, viewer: null }));
      },
      selectViewerTab(browserId) {
        setState((s) => (s.viewer ? { ...s, viewer: { ...s.viewer, browserId } } : s));
      },
      closeViewerTab(browserId) {
        setState((s) => {
          if (!s.viewer) return s;
          const closedTabs = [...s.viewer.closedTabs, browserId];
          const open = s.feed.flatMap((i) =>
            i.role === "card" && i.kind === "browser" && !closedTabs.includes(i.browser.id) ? [i.browser.id] : [],
          );
          if (open.length === 0) return { ...s, viewer: null };
          const active = s.viewer.browserId === browserId ? open[open.length - 1] : s.viewer.browserId;
          return { ...s, viewer: { browserId: active, closedTabs } };
        });
      },
      takeControl(browserId) {
        patchBrowser(browserId, { control: "user" });
      },
      handBack(browserId) {
        // Muse: Done returns the browser; the agent re-observes the page, then finishes.
        patchBrowser(browserId, { control: "agent", status: "working" });
        setState((s) => ({ ...s, agentStatus: { icon: "tool", text: "Re-observing page" } }));
        later(() => {
          patchBrowser(browserId, { status: "completed" });
          setState((s) => ({ ...s, agentStatus: null }));
          streamAgentReply("Thanks, I have the browser back. The page checks out and the run is **complete**.");
        }, 2500);
      },
      viewerStop(browserId) {
        patchBrowser(browserId, { control: "agent", status: "stopped" });
        streamAgentReply("Stopped the browser run where it was. Nothing was submitted.");
      },

      setChats(open) {
        setState((s) => ({ ...s, chatsOpen: open }));
      },
      setActivity(open) {
        setState((s) => ({ ...s, activityOpen: open }));
      },
      openSettings(section) {
        setState((s) => ({ ...s, settingsOpen: true, settingsSection: section, chatsOpen: false }));
      },
      closeSettings() {
        setState((s) => ({ ...s, settingsOpen: false, connectorDetail: null }));
      },
      openConnectorDetail(id) {
        setState((s) => ({ ...s, connectorDetail: id }));
      },
      toggleConnector(id) {
        setState((s) => ({
          ...s,
          connectors: s.connectors.map((c) => (c.id === id ? { ...c, connected: !c.connected } : c)),
        }));
      },
      setCapabilityLevel(connectorId, capabilityId, level: Level) {
        setState((s) => ({
          ...s,
          connectors: s.connectors.map((c) =>
            c.id === connectorId
              ? { ...c, capabilities: c.capabilities.map((cap) => (cap.id === capabilityId ? { ...cap, level } : cap)) }
              : c,
          ),
        }));
      },
      setWebsiteRuleLevel(id, level: Level) {
        setState((s) => ({ ...s, websiteRules: s.websiteRules.map((r) => (r.id === id ? { ...r, level } : r)) }));
      },
      addCredential(domain, username) {
        setState((s) => ({ ...s, credentials: [...s.credentials, { id: nextId("cred"), domain, username }] }));
      },

      resetDemo() {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setState(seedDemo());
      },
      setTheme(theme) {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.classList.toggle("light", theme !== "dark");
        setState((s) => ({ ...s })); // re-render for the checkmark
      },
    }),
    [later, patchFeed, patchBrowser, patchTask, streamAgentReply],
  );

  return (
    <div className="flex h-full" style={{ background: "var(--chat-background)" }}>
      <IconRail />
      {/* with the viewer open on desktop, the chat keeps the left 482px (Muse layout) */}
      <div className={`relative flex min-w-0 flex-1 flex-col ${state.viewer ? "lg:max-w-[410px]" : ""}`}>
        <ChatFeed state={state} actions={actions} />
        <TopBar state={state} actions={actions} />
        <MenuButton state={state} actions={actions} />
        <TaskPill state={state} actions={actions} />
        <Composer assistantThinking={state.assistantThinking} actions={actions} />
      </div>

      <ActivityPanel state={state} actions={actions} />
      <ChatsPanel state={state} actions={actions} />
      <SettingsModal state={state} actions={actions} />
      <ExplainerModal state={state} actions={actions} />
      <TaskDetailSheet state={state} actions={actions} />
      <Viewer state={state} actions={actions} />
    </div>
  );
}
