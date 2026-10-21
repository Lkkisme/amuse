/**
 * The Muse panel, opened by tapping Muse's avatar (Muse web): the avatar
 * travels into it (a view transition), with Muse's name and state, a
 * segmented control, and "Today": what Muse has done, newest first.
 *
 * Docked on the right; while the browser has the right, a floating window
 * over the chat instead; on a phone, a page of its own.
 */
import { CalendarClock, CircleCheck, Clock, Fingerprint, Globe, List, ListTodo, Pencil, Plug, ShieldCheck, X, Zap } from "lucide-react";
import type { Entity, State } from "@amuse/protocol";
import { museAvatar, travels } from "../transition.ts";
import type { Actions } from "../ui.ts";
import { browserLook, host, taskStatus, time } from "../view.ts";
import { repeats, scheduleState } from "../schedules.ts";

export type MuseMode = "docked" | "floating";

interface Done {
  id: string;
  title: string;
  sub: string;
  time: string;
  done: boolean;
  icon: typeof Globe;
}

/** What Muse did: its runs, tasks, asks and connections (the messages are in the chat). */
function done(entity: Entity): Done | null {
  const at = time(entity.at);
  switch (entity.kind) {
    case "prompt":
    case "reply":
      return null;
    case "browser":
      return { id: entity.id, title: entity.title, sub: `${browserLook(entity).label} · ${host(entity.url)}`, time: at, done: entity.status === "completed", icon: Globe };
    case "task": {
      const steps = entity.steps.filter((s) => s.done).length;
      return { id: entity.id, title: entity.title, sub: `${taskStatus[entity.status].label} · ${steps} of ${entity.steps.length} steps`, time: at, done: entity.status === "completed", icon: ListTodo };
    }
    case "approval": {
      const sub = { pending: "Waiting for your approval", approved: "Approved", denied: "Denied", timed_out: "Timed out" }[entity.status];
      return { id: entity.id, title: entity.action, sub, time: at, done: entity.status === "approved", icon: ShieldCheck };
    }
    case "connection":
      return { id: entity.id, title: `Connect ${entity.title}`, sub: entity.status === "connected" ? "Connected" : "Waiting for you to connect", time: at, done: entity.status === "connected", icon: Plug };    case "instruction":
    case "question":
      return null; // between the agents, not shown to the user
    case "failure":
      return null; // a notice in the chat, not something Amuse did
    case "schedule":
      return { id: entity.id, title: entity.title, sub: `${repeats(entity.when)} · ${scheduleState(entity)}`, time: at, done: entity.status === "done", icon: CalendarClock };
  }
}

const frame: Record<MuseMode, string> = {
  // a page of its own on a phone; on the right from md up
  docked: "fixed inset-0 z-50 md:static md:z-auto md:w-[360px] md:shrink-0 md:border-l",
  // over the chat, beside the rail, while the browser is on the right (lg up): within what the chat has
  // (16px clear of the viewer)
  floating: "fixed bottom-4 left-[72px] top-4 z-[55] w-[min(440px,calc(100vw-var(--viewer-width)-88px))] rounded-[28px]",
};

export function MusePanel({ conversation, mode, actions }: { conversation: State; mode: MuseMode; actions: Actions }) {
  const working = conversation.activity !== null;
  const list = conversation.entities.flatMap((e) => done(e) ?? []).reverse();

  return (
    <aside
      aria-label="Amuse"
      // where the avatar travels in, the panel comes in with it, in the same transition (index.css); a panel
      // sliding on its own would move the avatar's landing place under it
      className={`${frame[mode]} ${travels() ? "" : mode === "docked" ? "anim-pane-from-right" : "anim-popover-in"} flex flex-col overflow-hidden`}
      style={{ viewTransitionName: `muse-panel-${mode}`, background: "var(--bg-primary)", borderColor: "var(--fill-divider)", ...(mode === "floating" ? { boxShadow: "var(--shadow-sheet)" } : {}) }}
    >
      {/* 32px, 12px in: concentric with the floating window's 28px corners */}
      <button
        aria-label="Close"
        className="hover-fade absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full"
        style={{ color: "var(--icon-secondary)" }}
        onClick={() => actions.setMuse(false)}
      >
        <X size={20} />
      </button>

      <div className="flex flex-col items-center px-4 pt-12">
        <span className="relative">
          <span
            className="flex size-[100px] items-center justify-center rounded-full text-[38px] font-semibold"
            style={{ ...museAvatar, background: "var(--avatar-fill)", color: "var(--avatar-text)" }}
          >
            A
          </span>
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-full"
            style={{ background: "var(--fill-primary)", color: "var(--icon-primary)", boxShadow: "var(--shadow-float)" }}
          >
            <Pencil size={14} />
          </span>
        </span>
        <p className="mt-3 text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Amuse
        </p>
        {working ? (
          <p className="activity-indicator-fade text-[15px]" style={{ color: "var(--text-secondary)" }}>
            is working…
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-[15px]" style={{ color: "var(--text-secondary)" }}>
            <span className="flex size-4 items-center justify-center rounded-full" style={{ background: "var(--fill-green)", color: "#fff" }}>
              <Zap size={10} fill="currentColor" strokeWidth={0} />
            </span>
            Connected
          </p>
        )}
      </div>

      {/* segmented control: activity is the one there is so far */}
      <div className="mx-4 mt-7 grid h-[34px] grid-cols-4 rounded-full p-[3px]" style={{ background: "var(--fill-secondary)" }}>
        {[List, ShieldCheck, Clock, Fingerprint].map((Icon, i) => (
          <span
            key={i}
            className="flex items-center justify-center rounded-full"
            style={i === 0 ? { background: "var(--segment-selected)", color: "var(--icon-primary)", boxShadow: "var(--shadow-float)" } : { color: "var(--icon-secondary)" }}
          >
            <Icon size={16} />
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5">
        <p className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Today
        </p>
        {list.length === 0 ? (
          <p className="mt-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
            What Amuse does for you shows up here.
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {list.map((item) => {
              const Icon = item.done ? CircleCheck : item.icon;
              return (
                <li key={item.id} className="flex items-start gap-3">
                  <span
                    className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px]"
                    style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {item.title}
                    </span>
                    <span className="block text-[14px]" style={{ color: "var(--text-secondary)" }}>
                      {item.sub}
                    </span>
                    <span className="block text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                      {item.time}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
