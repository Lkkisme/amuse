/**
 * Floating task pill, centered under the avatar (Muse ref 08-now: top ~107px): follows the newest
 * browser run that is waiting for you (else the newest working one), opens
 * the viewer on tap, and offers Stop task.
 */
import { Globe } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import { browserStatusMeta, pillBrowser } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

export function TaskPill({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const run = pillBrowser(state.feed);
  if (!run) return null;
  const meta = browserStatusMeta[run.status];
  return (
    <div
      key={run.id}
      className="anim-fade-in absolute left-1/2 top-[106px] z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-1.5"
      style={{
        background: "color-mix(in srgb, var(--fill-primary) 88%, transparent)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
      }}
    >
      <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => actions.openViewer(run.id)}>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in srgb, ${meta.color} 12%, var(--fill-primary))`, color: meta.color }}
        >
          <Globe size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium leading-tight" style={{ color: "var(--text-primary)" }}>
            Browser
          </span>
          <span className="block max-w-[110px] truncate text-[13px] leading-tight" style={{ color: "var(--text-primary)" }}>
            {meta.label}…
          </span>
        </span>
      </button>
      <button
        className="hover-fade h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium"
        style={{ background: "var(--fill-secondary)", color: "var(--fill-red)" }}
        onClick={() => actions.viewerStop(run.id)}
      >
        Stop task
      </button>
    </div>
  );
}
