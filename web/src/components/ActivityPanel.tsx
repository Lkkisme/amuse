/**
 * Right activity panel: auto-opens while the agent works. Header = Muse
 * avatar + name + status line ('is working' -> green 'Connected') + pencil
 * edit; tab row (list / shield / clock / broadcast); 'Today' receipt list.
 * Enters with hatch-pane-enter-from-right.
 */
import { Check, List, Pencil, Radio, Shield, Clock } from "lucide-react";
import type { Entity, State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { browserStatus, host, taskStatus, time } from "../view.ts";
import { usePresence } from "./usePresence";

interface Receipt {
  title: string;
  sub: string;
  time: string;
  done: boolean;
}

function plain(text: string): string {
  return text.replace(/[*`]/g, "");
}

function receipt(entity: Entity): Receipt {
  const at = time(entity.at);
  switch (entity.kind) {
    case "prompt":
      return { title: "You asked Muse", sub: plain(entity.text), time: at, done: true };
    case "reply":
      return {
        title: entity.streaming ? "Muse is replying" : "Muse replied",
        sub: plain(entity.text.slice(0, 80)) || "Composing a response…",
        time: at,
        done: !entity.streaming,
      };
    case "task": {
      const done = entity.steps.filter((s) => s.done).length;
      return { title: entity.title, sub: `${taskStatus[entity.status].label} · ${done} of ${entity.steps.length} steps`, time: at, done: entity.status === "completed" };
    }
    case "approval": {
      const sub = { pending: "Waiting for your approval", approved: "Approved", denied: "Denied", timed_out: "Timed out" }[entity.status];
      return { title: entity.action, sub, time: at, done: entity.status !== "pending" };
    }
    case "browser":
      return { title: entity.title, sub: `${browserStatus[entity.status].label} · ${host(entity.url)}`, time: at, done: entity.status === "completed" };
    case "connection":
      return { title: `Connect ${entity.title}`, sub: entity.status === "connected" ? "Connected" : "Connector", time: at, done: entity.status === "connected" };
  }
}

export function ActivityPanel({ conversation, open, actions }: { conversation: State; open: boolean; actions: Actions }) {
  const working = conversation.activity !== null;
  // the close button closes it; new activity opens it again (App)
  const { mounted, closing, onAnimationEnd } = usePresence(open);

  if (!mounted) return null;
  const list = conversation.entities.map(receipt);

  return (
    <aside
      onAnimationEnd={onAnimationEnd}
      className={`${closing ? "anim-pane-to-right pointer-events-none" : "anim-pane-from-right"} hidden w-[320px] shrink-0 flex-col border-l md:flex`}
      style={{ borderColor: "var(--fill-divider)", background: "var(--bg-primary)" }}
      aria-label="Activity"
    >
      {/* header */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold ${working ? "avatar-ring-pulse" : ""}`}
          style={{ background: "var(--avatar-fill)", color: "var(--avatar-text)", boxShadow: "var(--shadow-float)" }}
        >
          M
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Muse
            </p>
            <button aria-label="Edit activity" className="hover-fade shrink-0 rounded p-1" style={{ color: "var(--icon-secondary)" }}>
              <Pencil size={14} />
            </button>
          </div>
          {working ? (
            <p className="activity-indicator-fade text-[13px]" style={{ color: "var(--text-secondary)" }}>
              is working…
            </p>
          ) : (
            <p className="anim-fade-in flex items-center gap-1 text-[13px] font-medium" style={{ color: "var(--fill-green)" }}>
              <span className="size-1.5 rounded-full" style={{ background: "var(--fill-green)" }} />
              Connected
            </p>
          )}
        </div>
      </div>

      {/* tab row */}
      <div className="mt-3 flex items-center gap-1 border-b px-3 pb-2" style={{ borderColor: "var(--fill-divider)" }}>
        {[List, Shield, Clock, Radio].map((Icon, i) => (
          <button
            key={i}
            aria-label={["Activity", "Security", "History", "Broadcast"][i]}
            className="hover-fade flex size-8 items-center justify-center rounded-lg"
            style={{
              color: i === 0 ? "var(--icon-primary)" : "var(--icon-secondary)",
              background: i === 0 ? "var(--fill-secondary)" : "transparent",
            }}
          >
            <Icon size={16} />
          </button>
        ))}
        <button
          aria-label="Close activity panel"
          className="hover-fade ml-auto flex size-8 items-center justify-center rounded-lg"
          style={{ color: "var(--icon-secondary)" }}
          onClick={() => actions.setActivity(false)}
        >
          <span className="text-[18px] leading-none">×</span>
        </button>
      </div>

      {/* receipt list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          Today
        </p>
        <ul className="mt-2 space-y-3">
          {list.map((r, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: r.done ? "var(--fill-green)" : "var(--fill-tertiary)", color: "#fff" }}
              >
                {r.done ? <Check size={12} /> : <span className="size-1.5 rounded-full bg-white/80" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {r.title}
                </span>
                <span className="block truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {r.sub}
                </span>
              </span>
              <span className="shrink-0 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                {r.time}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
