/**
 * Full-screen browser viewer (surfaces 4 + 5): fake live-desktop canvas with
 * a header that carries the takeover state machine — Muse driving (Take
 * control) -> You're in control (Hand back) -> back to Muse — plus Stop/Done.
 */
import { Hand, MousePointer2, Square, X } from "lucide-react";
import type { BrowserRun, DemoState } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

export function Viewer({ state, actions }: { state: DemoState; actions: MuseActions }) {
  if (!state.viewer) return null;
  const browser = state.feed.find(
    (i): i is Extract<typeof i, { role: "card"; kind: "browser" }> =>
      i.role === "card" && i.kind === "browser" && i.browser.id === state.viewer?.browserId,
  )?.browser;
  if (!browser) return null;
  return <ViewerBody browser={browser} control={state.viewer.control} actions={actions} />;
}

function ViewerBody({
  browser,
  control,
  actions,
}: {
  browser: BrowserRun;
  control: "agent" | "user";
  actions: MuseActions;
}) {
  const userInControl = control === "user";
  return (
    <div className="anim-pane-from-right fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg-primary)", animationDuration: "0.2s", animationTimingFunction: "ease-out" }}>
      {/* viewer header */}
      <header
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--fill-divider)", background: "var(--fill-primary)" }}
      >
        <button
          aria-label="Close viewer"
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ color: "var(--icon-primary)" }}
          onClick={() => actions.closeViewer()}
        >
          <X size={20} />
        </button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {browser.title}
          </p>
          <p className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {userInControl ? "You're in control" : "Muse is driving"} · {browser.site}
          </p>
        </div>

        {userInControl ? (
          <button
            className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold"
            style={{ background: "var(--fill-secondary)", color: "var(--text-primary)" }}
            onClick={() => actions.handBack()}
          >
            <MousePointer2 size={15} /> Hand back
          </button>
        ) : (
          <button
            className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => actions.takeControl()}
          >
            <Hand size={15} /> Take control
          </button>
        )}
        <button
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold sm:px-4"
          style={{ background: "var(--fill-secondary)", color: "var(--text-primary)" }}
          onClick={() => actions.viewerStop()}
        >
          <Square size={12} fill="currentColor" /> <span className="hidden sm:inline">Stop</span>
        </button>
        <button
          className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-semibold text-white sm:px-4"
          style={{ background: "var(--fill-blue)" }}
          onClick={() => actions.viewerDone()}
        >
          Done
        </button>
      </header>

      {/* fake live canvas */}
      <div className="flex flex-1 items-center justify-center p-6" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl"
          style={{ background: "var(--fill-primary)", boxShadow: "0 2px 16px rgba(0,0,0,0.08)" }}
        >
          <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ borderBottom: "1px solid var(--fill-divider)" }}>
            <span className="size-2.5 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
            <span className="size-2.5 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
            <span className="size-2.5 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
            <span
              className="ml-3 flex-1 truncate rounded-full px-3 py-1 text-[12px]"
              style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}
            >
              https://{browser.site}/
            </span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ background: `hsl(${browser.thumbnailHue} 45% 97%)` }}>
            <div className="h-5 w-1/3 rounded" style={{ background: `hsl(${browser.thumbnailHue} 45% 80%)` }} />
            <div className="h-3 w-1/2 rounded" style={{ background: `hsl(${browser.thumbnailHue} 30% 87%)` }} />
            <div className="h-3 w-2/5 rounded" style={{ background: `hsl(${browser.thumbnailHue} 30% 87%)` }} />
            <p className="mt-4 text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>
              {userInControl ? "You're in control — the browser is yours" : "Muse is driving this browser"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
