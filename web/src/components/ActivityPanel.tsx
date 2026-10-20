/**
 * Right activity panel: auto-opens while the agent works. Header = Muse
 * avatar + name + status line ('is working' -> green 'Connected') + pencil
 * edit; tab row (list / shield / clock / broadcast); 'Today' receipt list.
 * Enters with hatch-pane-enter-from-right.
 */
import { Check, List, Pencil, Radio, Shield, Clock } from "lucide-react";
import type { DemoState, FeedItem } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

interface Receipt {
  title: string;
  sub: string;
  time: string;
  done: boolean;
}

function plain(text: string): string {
  return text.replace(/[*`]/g, "");
}

function receiptsFromFeed(feed: FeedItem[]): Receipt[] {
  const out: Receipt[] = [];
  for (const item of feed) {
    if (item.role === "user") {
      out.push({ title: "You asked Muse", sub: plain(item.text), time: item.time, done: true });
    } else if (item.role === "agent") {
      out.push({
        title: item.streaming ? "Muse is replying" : "Muse replied",
        sub: plain(item.text.slice(0, 80)) || "Composing a response…",
        time: item.time,
        done: !item.streaming,
      });
    } else if (item.kind === "task") {
      out.push({ title: item.task.title, sub: `${item.task.steps.filter((s) => s.done).length} of ${item.task.steps.length} steps done`, time: "8:25 AM", done: item.task.status === "completed" });
    } else if (item.kind === "approval") {
      out.push({ title: item.approval.verb, sub: item.approval.status === "pending" ? "Waiting for your approval" : item.approval.status === "approved" ? "Approved" : "Denied", time: "8:26 AM", done: item.approval.status !== "pending" });
    } else if (item.kind === "browser") {
      out.push({ title: item.browser.title, sub: item.browser.site, time: "8:26 AM", done: item.browser.status === "completed" });
    } else if (item.kind === "connreq") {
      out.push({ title: `Connect ${item.connreq.app}`, sub: item.connreq.capability, time: "8:27 AM", done: item.connreq.status === "connected" });
    }
  }
  return out;
}

export function ActivityPanel({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const working = state.activityStatus === "working";
  const connected = state.activityStatus === "connected";
  const visible = state.activityOpen || state.activityStatus !== "idle";

  if (!visible) return null;
  const receipts = receiptsFromFeed(state.feed);

  return (
    <aside
      className="anim-pane-from-right hidden w-[320px] shrink-0 flex-col border-l md:flex"
      style={{ borderColor: "var(--fill-divider)", background: "var(--bg-primary)" }}
      aria-label="Activity"
    >
      {/* header */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold ${working ? "avatar-ring-pulse" : ""}`}
          style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.10)" }}
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
          ) : connected ? (
            <p className="anim-fade-in flex items-center gap-1 text-[13px] font-medium" style={{ color: "var(--fill-green)" }}>
              <span className="size-1.5 rounded-full" style={{ background: "var(--fill-green)" }} />
              Connected
            </p>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Idle
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
          {receipts.map((r, i) => (
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
