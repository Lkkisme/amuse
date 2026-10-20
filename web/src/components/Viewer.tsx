/**
 * Browser viewer (surfaces 4 + 5), per Muse refs 08-now, 09-waiting, 10-control,
 * 11-done. Desktop: a pane right of the chat; mobile: full screen.
 *
 * Header by status of the active run (Muse):
 *   queued/working/waiting  title · "<status> · host"            Stop + Take control of the browser
 *   needs_you               "Action required" · "Waiting for you · host"   Stop + Take control
 *   paused                  "You're in control" · host           Stop + Done (hand back)
 *   completed               title · "Completed · host"           Take control
 *   failed/stopped          title · "<status> · host"
 * Below it, one tab per browser run in the chat (check icon when completed), then a
 * fake Chrome window: page tab row, address bar, sketched page.
 */
import { ArrowLeft, ArrowRight, Check, CircleCheck, CircleDot, Copy, Globe, Menu, Plus, RotateCw, X } from "lucide-react";
import type { Browser, State } from "@remuse/protocol";
import type { Actions, Ui } from "../ui.ts";
import { browserStatus, browsers, byId, host, hue, path, stoppable } from "../view.ts";
import { useLastValue, usePresence } from "./usePresence";

export function Viewer({ conversation, viewer: open, actions }: { conversation: State; viewer: Ui["viewer"]; actions: Actions }) {
  const { mounted, closing, onAnimationEnd } = usePresence(open !== null);
  const viewer = useLastValue(open);
  if (!mounted || !viewer) return null;
  const browser = byId(conversation, "browser", viewer.browserId);
  if (!browser) return null;
  const tabs = browsers(conversation).filter((b) => !viewer.closedTabs.includes(b.id));

  return (
    <div
      onAnimationEnd={onAnimationEnd}
      className={`${closing ? "anim-pane-to-right pointer-events-none" : "anim-pane-from-right"} fixed inset-0 z-50 flex flex-col lg:left-[482px]`}
      style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--fill-divider)" }}
    >
      <ViewerHeader browser={browser} actions={actions} />
      <RunTabs tabs={tabs} activeId={browser.id} actions={actions} />
      <FakeChrome browser={browser} />
    </div>
  );
}

function ViewerHeader({ browser, actions }: { browser: Browser; actions: Actions }) {
  const user = browser.status === "paused";
  const title = user ? "You're in control" : browser.status === "needs_you" ? "Action required" : browser.title;
  const sub = user ? host(browser.url) : `${browserStatus[browser.status].label} · ${host(browser.url)}`;
  const canTake = stoppable(browser) || browser.status === "completed";

  return (
    <header className="flex items-center gap-2 py-2 pl-3 pr-2 sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          <span className="truncate">{sub}</span>
          <Copy size={12} className="shrink-0" />
        </p>
      </div>

      {stoppable(browser) && (
        <button
          className="hover-fade flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[14px] font-medium"
          style={{ color: "var(--fill-red)" }}
          onClick={() => actions.control(browser.id, "stop")}
        >
          <CircleDot size={15} /> <span className="hidden sm:inline">Stop</span>
        </button>
      )}
      {user ? (
        <button
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-4 text-[14px] font-medium text-white"
          style={{ background: "var(--fill-blue)" }}
          onClick={() => actions.control(browser.id, "handBack")}
        >
          <Check size={15} /> Done
        </button>
      ) : (
        canTake && <button
          className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3.5 text-[14px] font-medium text-white"
          style={{ background: "var(--fill-blue)" }}
          onClick={() => actions.control(browser.id, "take")}
        >
          <span className="sm:hidden">Take control</span>
          <span className="hidden sm:inline">Take control of the browser</span>
        </button>
      )}
      <button
        aria-label="Close viewer"
        className="hover-fade flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ color: "var(--icon-secondary)" }}
        onClick={() => actions.closeViewer()}
      >
        <X size={20} />
      </button>
    </header>
  );
}

/** One tab per browser run open in the viewer. */
function RunTabs({ tabs, activeId, actions }: { tabs: Browser[]; activeId: string; actions: Actions }) {
  return (
    <div className="flex items-end gap-1 overflow-x-auto px-2 pt-2" style={{ background: "var(--bg-secondary)" }}>
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        const Icon = tab.status === "completed" ? CircleCheck : Globe;
        return (
          <div
            key={tab.id}
            ref={selected ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
            className="flex h-10 w-[190px] shrink-0 items-center gap-2 rounded-t-[10px] pl-3 pr-1.5 text-[13px]"
            style={{
              background: selected ? "var(--bg-primary)" : "transparent",
              color: selected ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <button className="flex min-w-0 flex-1 items-center gap-2" onClick={() => actions.selectTab(tab.id)}>
              <Icon size={13} className="shrink-0" />
              <span className="truncate">{host(tab.url)}</span>
            </button>
            <button
              aria-label={`Close ${host(tab.url)}`}
              className="hover-fade flex size-6 shrink-0 items-center justify-center rounded-full"
              onClick={() => actions.closeTab(tab.id)}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Sketch of the remote Chrome window. Never a real page. */
function FakeChrome({ browser }: { browser: Browser }) {
  const h = hue(browser.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--fill-primary)" }}>
      <div className="flex items-center gap-2 px-2 pt-1.5" style={{ background: "var(--bg-secondary)", borderTop: "1px solid var(--fill-divider)" }}>
        <div
          className="flex h-8 w-[220px] items-center gap-2 rounded-t-lg px-3 text-[13px]"
          style={{ background: "var(--fill-primary)", color: "var(--text-primary)" }}
        >
          <span className="size-3.5 shrink-0 rounded-sm" style={{ background: `hsl(${h} 60% 50%)` }} />
          <span className="flex-1 truncate">
            {host(browser.url)}
            {path(browser.url)}
          </span>
          <X size={12} style={{ color: "var(--icon-secondary)" }} />
        </div>
        <Plus size={15} style={{ color: "var(--icon-secondary)" }} />
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5" style={{ color: "var(--icon-secondary)", borderBottom: "1px solid var(--fill-divider)" }}>
        <ArrowLeft size={16} />
        <ArrowRight size={16} style={{ opacity: 0.5 }} />
        <RotateCw size={15} />
        <span
          className="flex-1 truncate rounded-full px-4 py-1.5 text-[14px]"
          style={{ background: "var(--fill-secondary)", color: "var(--text-primary)" }}
        >
          {host(browser.url)}
          <span style={{ color: "var(--text-secondary)" }}>{path(browser.url)}</span>
        </span>
        <Menu size={16} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4" style={{ background: `hsl(${h} 45% 98%)` }}>
        <div className="h-5 w-40 rounded" style={{ background: `hsl(${h} 45% 80%)` }} />
        <div className="h-3 w-72 max-w-full rounded" style={{ background: `hsl(${h} 30% 88%)` }} />
        <div className="h-3 w-56 max-w-full rounded" style={{ background: `hsl(${h} 30% 88%)` }} />
        <div className="mt-2 h-7 w-48 rounded border" style={{ borderColor: `hsl(${h} 20% 75%)` }} />
        <div className="h-7 w-48 rounded border" style={{ borderColor: `hsl(${h} 20% 75%)` }} />
      </div>
    </div>
  );
}
