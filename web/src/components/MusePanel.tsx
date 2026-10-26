/**
 * The Muse panel, opened by tapping Muse's avatar (Muse web): the avatar
 * travels into it (a view transition), with Muse's name and state, a
 * segmented control: Activity ("Today": what Muse has done, newest first),
 * Approvals (every approval asked, in any chat, and how it ended) and
 * Upcoming (the schedules, next run first): Amuse's state and record. The
 * user's own things are in the sidebar, on the left.
 *
 * Docked on the right; while the browser has the right, a floating window
 * over the chat instead; on a phone, a page of its own.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { usePresence } from "./usePresence";
import { CalendarClock, CircleCheck, Clock, Globe, KeyRound, List, ListTodo, Plug, ShieldCheck, X } from "lucide-react";
import type { Approval, Chat, Entity, Schedule, Session, State } from "@amuse/protocol";
import { AppLogo } from "./AppLogo";
import { barButton, barButtonLook, barIcon } from "./bar";
import { museAvatar, travels } from "../transition.ts";
import type { Actions } from "../ui.ts";
import { browserLook, host, providerLogo, taskStatus, time } from "../view.ts";
import { moment, repeats, scheduleState } from "../schedules.ts";
import { useT } from "../i18n/react.ts";
import type { Messages } from "../i18n/en.ts";

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
function done(entity: Entity, t: Messages): Done | null {
  const at = time(entity.at);
  switch (entity.kind) {
    case "prompt":
    case "reply":
      return null;
    case "browser":
      return {
        id: entity.id,
        title: entity.title,
        sub: `${browserLook(entity, t).label} · ${host(entity.url)}`,
        time: at,
        done: entity.status === "completed",
        icon: Globe,
      };
    case "task": {
      const steps = entity.steps.filter((s) => s.done).length;
      return {
        id: entity.id,
        title: entity.title,
        sub: t.panel.taskSteps(taskStatus(entity.status, t).label, steps, entity.steps.length),
        time: at,
        done: entity.status === "completed",
        icon: ListTodo,
      };
    }
    case "approval": {
      const sub = entity.byRule ? t.panel.refusedByRule : t.panel.approvalState[entity.status];
      return {
        id: entity.id,
        title: entity.action,
        sub,
        time: at,
        done: entity.status === "approved",
        icon: ShieldCheck,
      };
    }
    case "secret":
      return {
        id: entity.id,
        title: entity.name,
        sub: t.panel.secretState[entity.status],
        time: at,
        done: entity.status === "provided",
        icon: KeyRound,
      };
    case "connection":
      return {
        id: entity.id,
        title: t.panel.connectTitle(entity.title),
        sub: entity.status === "connected" ? t.panel.connected : t.panel.waitingToConnect,
        time: at,
        done: entity.status === "connected",
        icon: Plug,
      };
    case "instruction":
    case "question":
      return null; // between the agents, not shown to the user
    case "failure":
      return null; // a notice in the chat, not something Amuse did
    case "schedule":
      return {
        id: entity.id,
        title: entity.title,
        sub: `${repeats(entity.when)} · ${scheduleState(entity)}`,
        time: at,
        done: entity.status === "done",
        icon: CalendarClock,
      };
  }
}

const frame: Record<MuseMode, string> = {
  // a page of its own on a phone; on the right from md up
  // from md, a rounded panel 8px in from the window's edges, like the sidebar; above the chat's fades
  // (the composer's), so they do not cut its shadow
  docked:
    "fixed inset-0 z-50 bg-[var(--bg-primary)] md:inset-y-2 md:left-auto md:right-2 md:z-[25] md:w-[360px] md:rounded-[24px] md:bg-[var(--panel)] md:shadow-[var(--shadow-panel)]",
  // over the chat while the browser is on the right (lg up): within what the chat has, beside a docked
  // sidebar (8px clear of it, of the window's edges and of the viewer)
  floating:
    "fixed bottom-2 left-[calc(var(--sidebar-width)+8px)] top-2 z-[55] w-[min(440px,calc(100vw-var(--viewer-width)-var(--sidebar-width)-24px))] rounded-[24px] bg-[var(--panel)]",
};

type Tab = "activity" | "approvals" | "upcoming";
const TAB_ICONS: { id: Tab; icon: typeof Globe }[] = [
  { id: "activity", icon: List },
  { id: "approvals", icon: ShieldCheck },
  { id: "upcoming", icon: Clock },
];

export function MusePanel({ open, conversation, session, mode: asked, actions }: { open: boolean; conversation: State; session: Session; mode: MuseMode; actions: Actions }) {
  const { mounted, closing, onAnimationEnd } = usePresence(open);
  // closing, it leaves the way it was (docked, it slides out right even as the browser takes its place)
  const kept = useRef(asked);
  if (!closing) kept.current = asked;
  const mode = kept.current;
  const t = useT();
  const working = conversation.activity !== null;
  const list = conversation.entities.flatMap((e) => done(e, t) ?? []).reverse();
  const [tab, setTab] = useState<Tab>("activity");

  // where it travels (a phone), the transition takes it away at once
  if (!mounted || (closing && travels())) return null;
  const motion = travels() ? "" : mode === "docked" ? (closing ? "anim-panel-out-right" : "anim-panel-in-right") : closing ? "anim-popover-out" : "anim-popover-in";

  return (
    <>
      {/* floating, it dims the chat (not the browser beside it); a tap there closes it */}
      {mode === "floating" && (
        <div
          className={`${closing ? "anim-fade-out" : "anim-fade-in"} fixed inset-y-0 left-0 z-[54] bg-black/30`}
          style={{ right: "var(--viewer-room)" }}
          onClick={() => actions.setMuse(false)}
        />
      )}
      <aside
        aria-label="Amuse"
        onAnimationEnd={onAnimationEnd}
        // on a phone, where the avatar travels in, the panel comes in with it, in the same transition (index.css); elsewhere
        // it slides in whole, pushing the chat aside as the sidebar and the browser do
        className={`${frame[mode]} ${motion} ${closing ? "pointer-events-none" : ""} flex flex-col overflow-hidden`}
        style={{
          viewTransitionName: `muse-panel-${mode}`,
          ...(mode === "floating" ? { boxShadow: "var(--shadow-sheet)" } : {}),
        }}
      >
        {/* the round button the bars have, 12px from the window's corner (4px in from the panel's, from md) */}
        <button
          aria-label={t.common.close}
          className={`${barButton} absolute right-3 top-3 z-10 md:right-1 md:top-1`}
          style={barButtonLook}
          onClick={() => actions.setMuse(false)}
        >
          <X size={barIcon} />
        </button>

        <div className="flex flex-col items-center px-4 pt-12">
          <span className="relative">
            <span
              data-muse-avatar=""
              className="flex size-[100px] items-center justify-center rounded-full text-[38px] font-semibold"
              style={{
                ...museAvatar,
                background: "var(--avatar-fill)",
                color: "var(--avatar-text)",
              }}
            >
              A
            </span>
          </span>
          <p className="mt-3 text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Amuse
          </p>
          {/* only what is true now: nothing is said while it rests */}
          <p className={`text-[15px] ${working ? "activity-indicator-fade" : "invisible"}`} style={{ color: "var(--text-secondary)" }}>
            {t.panel.working}
          </p>
        </div>

        {/* segmented control: what Amuse did, what it asked, what comes next */}
        <div role="tablist" className="mx-4 mt-7 grid h-[34px] grid-cols-3 rounded-full p-[3px]" style={{ background: "var(--fill-secondary)" }}>
          {TAB_ICONS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-label={t.panel.tabs[id]}
              aria-selected={tab === id}
              className="flex items-center justify-center rounded-full"
              style={
                tab === id
                  ? {
                      background: "var(--segment-selected)",
                      color: "var(--icon-primary)",
                      boxShadow: "var(--shadow-float)",
                    }
                  : { color: "var(--icon-secondary)" }
              }
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>

        {tab === "approvals" && <Approvals session={session} conversation={conversation} actions={actions} />}
        {tab === "upcoming" && <Upcoming session={session} />}
        {tab === "activity" && (
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-5">
            <p className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {t.panel.today}
            </p>
            {list.length === 0 ? (
              <p className="mt-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
                {t.panel.activityNone}
              </p>
            ) : (
              <ul className="mt-3 space-y-4">
                {list.map((item) => {
                  const Icon = item.done ? CircleCheck : item.icon;
                  return (
                    <li key={item.id} className="flex items-start gap-3">
                      <span
                        className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px]"
                        style={{
                          background: "var(--fill-secondary)",
                          color: "var(--icon-primary)",
                        }}
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
        )}
      </aside>
    </>
  );
}

/** How an approval ended, "always" said when it became a rule; one the user's rule refused was never asked. */
function outcome(a: Approval, t: Messages): string {
  if (a.byRule) return t.panel.outcomes.refusedByRule;
  if (a.always && a.status !== "pending" && a.status !== "timed_out")
    return a.status === "approved" ? t.panel.outcomes.alwaysAllowed : t.panel.outcomes.alwaysDenied;
  return { pending: t.panel.outcomes.pending, approved: t.panel.outcomes.allowed, denied: t.panel.outcomes.denied, timed_out: t.panel.outcomes.timedOut }[a.status];
}

/**
 * Every approval asked, in any chat, newest first: what, for which app or site, how it ended,
 * when, and where (a tap goes to its chat). Narrowed to one app or site; the rules that answer
 * without asking are in Settings › Permissions.
 */
function Approvals({ session, conversation, actions }: { session: Session; conversation: State; actions: Actions }) {
  const t = useT();
  const [rows, setRows] = useState<{ chat: Chat; approval: Approval }[] | null>(null);
  const [only, setOnly] = useState("");
  // asked again as the chat moves (a card answered, a new one)
  useEffect(() => {
    session.call("approvals.list", {}).then(
      ({ approvals }) => setRows(approvals),
      () => setRows([]),
    );
  }, [session, conversation.seq]);
  const source = (a: Approval) => a.app ?? a.target;
  const sources = [...new Set((rows ?? []).map((r) => source(r.approval)))].sort();
  const shown = (rows ?? []).filter((r) => !only || source(r.approval) === only);
  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {t.panel.tabs.approvals}
        </p>
        {sources.length > 1 && (
          <select
            aria-label={t.panel.onlyFor}
            className="max-w-[50%] truncate bg-transparent text-right text-[14px] outline-none"
            style={{ color: "var(--text-secondary)" }}
            value={only}
            onChange={(e) => setOnly(e.target.value)}
          >
            <option value="">{t.panel.all}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>
      {rows === null ? (
        <div className="skeleton mt-3 h-12 rounded-[10px]" />
      ) : shown.length === 0 ? (
        <p className="mt-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
          {t.panel.approvalsNone}
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {shown.map(({ chat, approval: a }) => (
            <li key={a.id}>
              <button className="flex w-full items-start gap-3 text-left" onClick={() => actions.openChat(chat.id)}>
                {a.app ? (
                  <AppLogo name={a.app} logo={providerLogo(a.app)} size={38} />
                ) : (
                  <span
                    className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                      background: "var(--fill-secondary)",
                      color: "var(--icon-primary)",
                    }}
                  >
                    <ShieldCheck size={18} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {a.action}
                  </span>
                  <span
                    className="block truncate text-[14px]"
                    style={{
                      color: a.status === "denied" ? "var(--fill-red)" : "var(--text-secondary)",
                    }}
                  >
                    {outcome(a, t)} · {a.target}
                  </span>
                  <span className="block text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    {moment(a.at)}
                    {chat.title ? ` · ${chat.title}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="plain"
        tone="accent"
        className="-ml-4 mt-5"
        onClick={() => actions.openSettings("permissions")}
      >
        {t.panel.managePermissions}
      </Button>
    </div>
  );
}

/** What runs next: the schedules that will, soonest first. */
function Upcoming({ session }: { session: Session }) {
  const t = useT();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  useEffect(() => {
    session.call("schedules.list", {}).then(
      ({ schedules }) => setSchedules(schedules),
      () => setSchedules([]),
    );
  }, [session]);
  const next = (schedules ?? []).filter((s) => s.status === "active" && s.next !== null).sort((a, b) => Date.parse(a.next ?? "") - Date.parse(b.next ?? ""));
  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-5">
      <p className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {t.panel.tabs.upcoming}
      </p>
      {schedules === null ? (
        <div className="skeleton mt-3 h-12 rounded-[10px]" />
      ) : next.length === 0 ? (
        <p className="mt-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
          {t.panel.upcomingNone}
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {next.map((s) => (
            <li key={s.id} className="flex items-start gap-3">
              <span
                className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px]"
                style={{
                  background: "var(--fill-secondary)",
                  color: "var(--icon-primary)",
                }}
              >
                <CalendarClock size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {s.title}
                </span>
                <span className="block text-[14px]" style={{ color: "var(--text-secondary)" }}>
                  {moment(s.next ?? "")}
                </span>
                <span className="block text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                  {repeats(s.when)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
