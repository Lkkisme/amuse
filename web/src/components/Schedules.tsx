/**
 * Settings › Schedules: the work Muse set up to run later or regularly
 * (schedules.list; the feed a client holds may not reach back to them). Each
 * can be paused, resumed (from then on) or deleted (cancelled for good).
 * Done and cancelled ones are not listed (they are kept, as a record).
 */
import { useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Dropped } from "@amuse/api/client";
import type { Needs, Schedule, Session } from "@amuse/protocol";
import { moment, outcomeLabel, repeats, scheduleState } from "../schedules.ts";
import { wordsFor } from "../shown.ts";
import { Button } from "./Button";
import { useT } from "../i18n/react.ts";

type Control = "pause" | "resume" | "cancel";

export function Schedules({ session }: { session: Session }) {
  const t = useT();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  // A successful list read may clear its own failure, never a separate control refusal.
  const [readError, setReadError] = useState<unknown>(null);
  const [controlError, setControlError] = useState<unknown>(null);
  const reader = useRef<{ load(changed?: boolean): Promise<void>; active(): boolean } | null>(null);
  const controlVersion = useRef(0);
  useEffect(() => {
    let live = true;
    let pending: Promise<void> | null = null;
    let dropped = false;
    let refreshAgain = false;
    const load = (changed = false): Promise<void> => {
      if (!live) return Promise.resolve();
      if (pending) { refreshAgain ||= changed; return pending; }
      dropped = false;
      let succeeded = false;
      pending = session.call("schedules.list", {}).then(
        ({ schedules }) => {
          if (!live) return;
          succeeded = true;
          setSchedules(schedules);
          setReadError(null);
        },
        (error: unknown) => {
          if (!live) return;
          dropped = error instanceof Dropped;
          setReadError(error);
        },
      ).finally(() => {
        pending = null;
        const again = refreshAgain;
        refreshAgain = false;
        // Changes during a read need one newer snapshot; a failed read still waits for recovery.
        if (live && succeeded && again) void load();
      });
      return pending;
    };
    const current = { load, active: () => live };
    reader.current = current;
    const unsubscribe = session.subscribe((update) => {
      if (
        // A successful heartbeat/reconnect can have no new session events to reset this page.
        (update.kind === "chats" && dropped) || update.kind === "reset" ||
        (update.kind === "event" && update.envelope.event.kind === "upserted" &&
          update.envelope.event.entity.kind === "schedule")
      ) void load(update.kind !== "chats");
    });
    void load();
    return () => {
      live = false;
      unsubscribe();
      if (reader.current === current) reader.current = null;
    };
  }, [session]);
  const control = (id: string, action: Control) => {
    const current = reader.current;
    if (!current) return;
    const version = ++controlVersion.current;
    setControlError(null);
    session
      .call("schedule.control", { id, action })
      .then(() => current.load(true), (error: unknown) => {
        if (current.active() && version === controlVersion.current) setControlError(error);
      });
  };
  const error = wordsFor(controlError ?? readError, t);
  const standing =
    schedules?.filter((s) => s.status === "active" || s.status === "paused") ??
    [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.schedule.description}
      </p>
      {schedules && standing.length === 0 && (
        <p
          className="mt-6 text-center text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.schedule.none}
        </p>
      )}
      {standing.length > 0 && <List schedules={standing} control={control} />}
      {error && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

function List({
  schedules,
  control,
}: {
  schedules: Schedule[];
  control: (id: string, action: Control) => void;
}) {
  const t = useT();
  return (
    <ul
      className="mt-3 divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
      style={{ background: "var(--fill-secondary)" }}
    >
      {schedules.map((s) => (
        <li key={s.id} className="py-3">
          <div className="flex items-start gap-3">
            <CalendarClock
              size={16}
              className="mt-0.5 shrink-0"
              style={{ color: "var(--icon-secondary)" }}
            />
            <div className="min-w-0 flex-1">
              <p
                className="text-[15px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {s.title}
              </p>
              <p
                className="text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {repeats(s.when)}
                {s.needs ? ` ${t.schedule.waits[s.needs]}` : ""} ·{" "}
                {scheduleState(s)}
                {s.preset ? ` · ${t.schedule.builtIn}` : ""}
              </p>
              {s.last && (
                <p
                  className="mt-0.5 text-[13px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t.schedule.lastRun(
                    moment(s.last.at),
                    outcomeLabel(s.last.outcome),
                    s.last.outcome !== "missed" && s.last.summary
                      ? s.last.summary
                      : null,
                  )}
                </p>
              )}
              <details className="mt-1">
                <summary
                  className="cursor-pointer text-[13px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t.schedule.instructions}
                </summary>
                <p
                  className="mt-1 whitespace-pre-wrap text-[13px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {s.instructions}
                </p>
              </details>
            </div>
          </div>
          {(s.status === "active" || s.status === "paused") && (
            <div className="mt-2 flex justify-end gap-2">
              <Button
                onCard
                onClick={() =>
                  control(s.id, s.status === "active" ? "pause" : "resume")
                }
              >
                {s.status === "active" ? t.schedule.pause : t.schedule.resume}
              </Button>
              <Button
                onCard
                tone="danger"
                onClick={() => control(s.id, "cancel")}
              >
                {t.schedule.delete}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
