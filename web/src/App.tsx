/**
 * remuse web app — one page, local fake state only (docs/ui-spec.md).
 * App owns the single DemoState and implements every MuseAction against it.
 * No network, no backend: all "live" behavior is scripted timers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoState, FeedItem, Level } from "./data/fakeMuse";
import { seedDemo } from "./data/fakeMuse";
import type { MuseActions } from "./components/actions";
import { ChatFeed } from "./components/ChatFeed";
import { Composer } from "./components/Composer";
import { Drawer } from "./components/Drawer";
import { TopBar, StatusPill } from "./components/TopBar";
import { SettingsModal } from "./components/SettingsModal";
import { ExplainerModal } from "./components/ExplainerModal";
import { Viewer } from "./components/Viewer";

let idSeq = 100;
const nextId = (prefix: string) => `${prefix}${idSeq++}`;

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
    (taskId: string, fn: (t: Extract<FeedItem, { kind: "task" }>["task"]) => Extract<FeedItem, { kind: "task" }>["task"]) => {
      patchFeed((feed) =>
        feed.map((item) =>
          item.role === "card" && item.kind === "task" && item.task.id === taskId ? { ...item, task: fn(item.task) } : item,
        ),
      );
    },
    [patchFeed],
  );

  const patchBrowser = useCallback(
    (browserId: string, patch: Partial<Extract<FeedItem, { kind: "browser" }>["browser"]>) => {
      patchFeed((feed) =>
        feed.map((item) =>
          item.role === "card" && item.kind === "browser" && item.browser.id === browserId
            ? { ...item, browser: { ...item.browser, ...patch } }
            : item,
        ),
      );
    },
    [patchFeed],
  );

  const actions = useMemo<MuseActions>(
    () => ({
      send(text) {
        if (!text.trim()) return;
        patchFeed((feed) => [...feed, { id: nextId("m"), role: "user", text }]);
        setState((s) => ({ ...s, assistantThinking: true, statusPill: "Muse is responding" }));
        later(() => {
          setState((s) => ({ ...s, assistantThinking: false, statusPill: null }));
          patchFeed((feed) => [
            ...feed,
            {
              id: nextId("m"),
              role: "agent",
              text: `Got it — "${text}". I'll take that from here and report back in the feed.`,
            },
          ]);
        }, 1600 + Math.random() * 900);
      },

      stopAssistant() {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setState((s) => ({ ...s, assistantThinking: false, statusPill: null }));
      },

      resolveApproval(id, approved) {
        patchFeed((feed) =>
          feed.map((item) =>
            item.role === "card" && item.kind === "approval" && item.approval.id === id
              ? { ...item, approval: { ...item.approval, status: approved ? "approved" : "denied" } }
              : item,
          ),
        );
        later(() => {
          patchFeed((feed) => [
            ...feed,
            {
              id: nextId("m"),
              role: "agent",
              text: approved ? "Approved — sending it now." : "Understood, I dropped the draft.",
            },
          ]);
        }, 500);
      },

      submitTaskForm(taskId, values) {
        patchTask(taskId, (t) => ({
          ...t,
          status: "working",
          form: t.form?.map((f) => ({ ...f, value: values[f.field] ?? f.value })),
        }));
        setState((s) => ({ ...s, statusPill: "Working" }));
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
          setState((s) => ({ ...s, statusPill: null }));
          patchFeed((feed) => [
            ...feed,
            { id: nextId("m"), role: "agent", text: "Thanks — answers noted and the task is complete." },
          ]);
        }, 3400);
      },

      requestConnect(connreqId) {
        patchFeed((feed) =>
          feed.map((item) =>
            item.role === "card" && item.kind === "connreq" && item.connreq.id === connreqId
              ? { ...item, connreq: { ...item.connreq, status: "explaining" } }
              : item,
          ),
        );
        setState((s) => ({ ...s, explainerFor: connreqId }));
      },

      confirmConnect(connreqId) {
        setState((s) => ({ ...s, explainerFor: null }));
        patchFeed((feed) =>
          feed.map((item) =>
            item.role === "card" && item.kind === "connreq" && item.connreq.id === connreqId
              ? { ...item, connreq: { ...item.connreq, status: "connected" } }
              : item,
          ),
        );
        later(() => {
          patchFeed((feed) => [
            ...feed,
            { id: nextId("m"), role: "agent", text: "Connected. I can read from it now — want me to pull a sample?" },
          ]);
        }, 500);
      },

      dismissConnect(connreqId) {
        setState((s) => ({ ...s, explainerFor: null }));
        patchFeed((feed) =>
          feed.map((item) =>
            item.role === "card" && item.kind === "connreq" && item.connreq.id === connreqId
              ? { ...item, connreq: { ...item.connreq, status: "pending" } }
              : item,
          ),
        );
      },

      openViewer(browserId) {
        setState((s) => ({ ...s, viewer: { browserId, control: "agent" } }));
      },
      closeViewer() {
        setState((s) => ({ ...s, viewer: null }));
      },
      takeControl() {
        setState((s) => (s.viewer ? { ...s, viewer: { ...s.viewer, control: "user" } } : s));
      },
      handBack() {
        setState((s) => (s.viewer ? { ...s, viewer: { ...s.viewer, control: "agent" } } : s));
      },
      viewerStop() {
        setState((s) => {
          if (s.viewer) patchBrowser(s.viewer.browserId, { status: "failed" });
          return { ...s, viewer: null, statusPill: null };
        });
        patchFeed((feed) => [
          ...feed,
          { id: nextId("m"), role: "agent", text: "Stopped the browser run where it was. Nothing was submitted." },
        ]);
      },
      viewerDone() {
        setState((s) => {
          if (s.viewer) patchBrowser(s.viewer.browserId, { status: "completed" });
          return { ...s, viewer: null };
        });
        patchFeed((feed) => [
          ...feed,
          { id: nextId("m"), role: "agent", text: "Session closed and control is back with me. Continuing the task." },
        ]);
      },

      setDrawer(open, view) {
        setState((s) => ({ ...s, drawerOpen: open, drawerView: view ?? s.drawerView }));
      },
      openSettings(section) {
        setState((s) => ({ ...s, settingsOpen: true, settingsSection: section, drawerOpen: false }));
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
    [later, patchFeed, patchBrowser, patchTask],
  );

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--chat-background)" }}>
      <TopBar state={state} actions={actions} />
      <StatusPill state={state} />
      <ChatFeed state={state} actions={actions} />
      <Composer assistantThinking={state.assistantThinking} actions={actions} />

      <Drawer state={state} actions={actions} />
      <SettingsModal state={state} actions={actions} />
      <ExplainerModal state={state} actions={actions} />
      <Viewer state={state} actions={actions} />
    </div>
  );
}
