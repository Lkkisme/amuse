/**
 * Browser viewer (surfaces 4 + 5), per Muse refs 08-now, 09-waiting, 10-control,
 * 11-done. Desktop: a pane right of the chat; mobile: full screen.
 *
 * Header by state of the active run:
 *   working    title · "Working · site"          Stop + Take control of the browser
 *   waiting    "Action required" · "Waiting for you · site"   Stop + Take control
 *   completed  title · "Completed · site"        Take control only
 *   user       "You're in control" · site        Stop + Done
 * Below it, one tab per browser run in the chat (check icon when completed), then a
 * fake Chrome window: page tab row, address bar, sketched page.
 */
import { ArrowLeft, ArrowRight, Check, CircleCheck, CircleDot, Copy, Globe, Menu, Plus, RotateCw, X } from "lucide-react";
import type { BrowserRun, DemoState } from "../data/fakeMuse";
import { browserStatusMeta, findBrowser } from "../data/fakeMuse";
import type { MuseActions } from "./actions";
import { useLastValue, usePresence } from "./usePresence";

export function Viewer({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const { mounted, closing, onAnimationEnd } = usePresence(state.viewer !== null);
  const viewer = useLastValue(state.viewer);
  if (!mounted || !viewer) return null;
  const browser = findBrowser(state.feed, viewer.browserId);
  if (!browser) return null;
  const tabs = state.feed.flatMap((i) =>
    i.role === "card" && i.kind === "browser" && !viewer.closedTabs.includes(i.browser.id) ? [i.browser] : [],
  );

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

function ViewerHeader({ browser, actions }: { browser: BrowserRun; actions: MuseActions }) {
  const user = browser.control === "user";
  const active = browser.status === "working" || browser.status === "waiting";
  const title = user ? "You're in control" : browser.status === "waiting" ? "Action required" : browser.title;
  const sub = user ? browser.site : `${browserStatusMeta[browser.status].label} · ${browser.site}`;

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

      {(active || user) && (
        <button
          className="hover-fade flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[14px] font-medium"
          style={{ color: "var(--fill-red)" }}
          onClick={() => actions.viewerStop(browser.id)}
        >
          <CircleDot size={15} /> <span className="hidden sm:inline">Stop</span>
        </button>
      )}
      {user ? (
        <button
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-4 text-[14px] font-medium text-white"
          style={{ background: "var(--fill-blue)" }}
          onClick={() => actions.handBack(browser.id)}
        >
          <Check size={15} /> Done
        </button>
      ) : (
        <button
          className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3.5 text-[14px] font-medium text-white"
          style={{ background: "var(--fill-blue)" }}
          onClick={() => actions.takeControl(browser.id)}
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
function RunTabs({ tabs, activeId, actions }: { tabs: BrowserRun[]; activeId: string; actions: MuseActions }) {
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
            <button className="flex min-w-0 flex-1 items-center gap-2" onClick={() => actions.selectViewerTab(tab.id)}>
              <Icon size={13} className="shrink-0" />
              <span className="truncate">{tab.site}</span>
            </button>
            <button
              aria-label={`Close ${tab.site}`}
              className="hover-fade flex size-6 shrink-0 items-center justify-center rounded-full"
              onClick={() => actions.closeViewerTab(tab.id)}
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
function FakeChrome({ browser }: { browser: BrowserRun }) {
  const hue = browser.thumbnailHue;
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--fill-primary)" }}>
      <div className="flex items-center gap-2 px-2 pt-1.5" style={{ background: "var(--bg-secondary)", borderTop: "1px solid var(--fill-divider)" }}>
        <div
          className="flex h-8 w-[220px] items-center gap-2 rounded-t-lg px-3 text-[13px]"
          style={{ background: "var(--fill-primary)", color: "var(--text-primary)" }}
        >
          <span className="size-3.5 shrink-0 rounded-sm" style={{ background: `hsl(${hue} 60% 50%)` }} />
          <span className="flex-1 truncate">
            {browser.site}
            {browser.path}
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
          {browser.site}
          <span style={{ color: "var(--text-secondary)" }}>{browser.path}</span>
        </span>
        <Menu size={16} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4" style={{ background: `hsl(${hue} 45% 98%)` }}>
        <div className="h-5 w-40 rounded" style={{ background: `hsl(${hue} 45% 80%)` }} />
        <div className="h-3 w-72 max-w-full rounded" style={{ background: `hsl(${hue} 30% 88%)` }} />
        <div className="h-3 w-56 max-w-full rounded" style={{ background: `hsl(${hue} 30% 88%)` }} />
        <div className="mt-2 h-7 w-48 rounded border" style={{ borderColor: `hsl(${hue} 20% 75%)` }} />
        <div className="h-7 w-48 rounded border" style={{ borderColor: `hsl(${hue} 20% 75%)` }} />
      </div>
    </div>
  );
}
