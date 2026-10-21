/**
 * A goal's page, over the Amuse panel (a page of its own on a phone): what
 * the goal is and where it stands (its GOAL.md), the schedules that serve
 * it, and its timeline (progress and the nightly research). Muting keeps
 * Amuse at it without bringing it up; a done goal can be reopened, and its
 * schedules rest until then.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Bell, BellOff, CalendarClock, ChevronLeft } from "lucide-react";
import type { Goal, GoalNote, Schedule, Session } from "@amuse/protocol";
import { repeats, scheduleState } from "../schedules.ts";
import { RichText } from "./markdown";
import { day, reason } from "./Goals";

export function GoalPage({
  session,
  id,
  onBack,
}: {
  session: Session;
  id: string;
  onBack: () => void;
}) {
  const [shown, setShown] = useState<{ goal: Goal; log: GoalNote[] } | null>(
    null,
  );
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    session.call("goals.get", { id }).then(setShown, (e: unknown) => {
      setShown(null);
      setError(reason(e));
    });
    session.call("schedules.list", {}).then(
      ({ schedules }) =>
        setSchedules(
          schedules.filter(
            (s) =>
              s.goal === id && (s.status === "active" || s.status === "paused"),
          ),
        ),
      () => setSchedules([]),
    );
  }, [session, id]);
  useEffect(() => load(), [load]);

  const update = (change: { status?: Goal["status"]; muted?: boolean }) => {
    setBusy(true);
    setError(null);
    session
      .call("goals.update", { id, ...change })
      .then(load, (e: unknown) => setError(reason(e)))
      .finally(() => setBusy(false));
  };

  const goal = shown?.goal;
  return (
    <div
      className="anim-pane-from-right absolute inset-0 z-20 flex flex-col"
      style={{ background: "var(--bg-primary)" }}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-2">
        <button
          aria-label="Back"
          className="hover-fade flex size-10 items-center justify-center rounded-full"
          style={{ color: "var(--icon-primary)" }}
          onClick={onBack}
        >
          <ChevronLeft size={24} />
        </button>
        {goal && (
          <button
            aria-label={goal.muted ? "Unmute" : "Mute"}
            disabled={busy}
            className="hover-fade flex size-10 items-center justify-center rounded-full disabled:opacity-40"
            style={{ color: "var(--icon-primary)" }}
            onClick={() => update({ muted: !goal.muted })}
          >
            {goal.muted ? <BellOff size={20} /> : <Bell size={20} />}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {error && (
          <p
            role="alert"
            className="mb-3 text-[14px]"
            style={{ color: "var(--fill-red)" }}
          >
            {error}
          </p>
        )}
        {!goal ? (
          !error && <div className="skeleton h-8 w-3/5 rounded-[10px]" />
        ) : (
          <>
            <p
              className="text-[24px] font-semibold leading-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {goal.title}
            </p>
            <p
              className="mt-1 text-[14px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {goal.status === "done" ? "Done" : "Working on it"}
              {goal.added
                ? ` · ${goal.status === "done" ? "started" : "since"} ${day(goal.added)}`
                : ""}
            </p>
            {goal.muted && (
              <p
                className="mt-2 flex items-center gap-1.5 text-[13px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                <BellOff size={14} />
                Muted: Amuse keeps at it, but does not bring it up.
              </p>
            )}

            {goal.about && (
              <div
                className="mt-5 text-[16px] leading-[24px]"
                style={{ color: "var(--text-primary)" }}
              >
                <RichText text={goal.about} />
              </div>
            )}

            <Section title="Scheduled for it">
              {schedules === null ? (
                <div className="skeleton h-10 rounded-[10px]" />
              ) : schedules.length === 0 ? (
                <p
                  className="text-[14px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {goal.status === "done"
                    ? "Nothing is scheduled for it."
                    : "Nothing is scheduled for it yet. Ask Amuse, for example for a reminder that helps."}
                </p>
              ) : (
                <ul className="space-y-3">
                  {schedules.map((s) => (
                    <li key={s.id} className="flex items-start gap-3">
                      <span
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px]"
                        style={{
                          background: "var(--fill-secondary)",
                          color: "var(--icon-primary)",
                        }}
                      >
                        <CalendarClock size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block text-[15px] font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {s.title}
                        </span>
                        <span
                          className="block text-[13px]"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {repeats(s.when)} ·{" "}
                          {goal.status === "done"
                            ? "resting while the goal is done"
                            : scheduleState(s)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {shown.log.length > 0 && (
              <Section title="Timeline">
                <ul className="space-y-5">
                  {shown.log.map((note, i) => (
                    <li key={i}>
                      <p
                        className="text-[13px]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {day(note.day)}
                        {note.label ? ` · ${note.label}` : ""}
                      </p>
                      <div
                        className="mt-0.5 text-[15px] leading-[22px]"
                        style={{ color: "var(--text-primary)" }}
                      >
                        <RichText text={note.text} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <button
              disabled={busy}
              className="hover-fade mt-8 h-12 w-full rounded-full text-[16px] font-semibold disabled:opacity-40"
              style={{
                background: "var(--fill-secondary)",
                color: "var(--text-primary)",
              }}
              onClick={() =>
                update({ status: goal.status === "done" ? "active" : "done" })
              }
            >
              {goal.status === "done" ? "Take it up again" : "Mark as done"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <p
        className="mb-3 text-[13px] font-semibold"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
      </p>
      {children}
    </section>
  );
}
