/**
 * Cards in the chat feed: one component per non-message entity kind.
 * Props are protocol entities; behavior goes through Actions.
 */
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Globe,
  ListTodo,
  ShieldCheck,
} from "lucide-react";
import type {
  Approval,
  Browser,
  Connection,
  Failure,
  Schedule,
  Task,
} from "@amuse/protocol";
import { repeats, scheduleState } from "../schedules.ts";
import type { Actions } from "../ui.ts";
import { type Place, alone, corners } from "./shape.ts";
import { AppLogo } from "./AppLogo";
import { useEffect, useState } from "react";
import {
  bannerActive,
  browserLook,
  hue,
  providerLogo,
  taskStatus,
} from "../view.ts";

const CARD_BG = "var(--fill-secondary)";

/** A card's outer box: Muse's side, its corners set by its place in the feed (shape.ts). */
const shell = (place: Place, className: string, round?: number) => ({
  className,
  style: { background: CARD_BG, ...corners("muse", place, round) },
});

/* ---------- Task ---------- */

export function TaskCard({
  task,
  place = alone,
  actions,
}: {
  task: Task;
  place?: Place;
  actions: Actions;
}) {
  const meta = taskStatus[task.status];
  const done = task.steps.filter((s) => s.done).length;
  return (
    <div {...shell(place, "w-full max-w-[340px] p-4")}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{
            background: "var(--fill-primary)",
            color: "var(--icon-primary)",
          }}
        >
          <ListTodo size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className="truncate text-[15px] font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {task.title}
            </p>
            <button
              aria-label="Open task details"
              className="hover-fade shrink-0 rounded p-0.5"
              style={{ color: "var(--icon-secondary)" }}
              onClick={() => actions.openTaskDetail(task.id)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span
            className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: meta.color }}
          >
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: meta.color }}
            />
            {meta.label}
          </span>
        </div>
      </div>

      {task.steps.length > 0 && (
        <div className="mt-3">
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--fill-tertiary)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(done / task.steps.length) * 100}%`,
                background: "var(--fill-blue)",
              }}
            />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {task.steps.map((step) => (
              <li
                key={step.label}
                className="flex items-center gap-2 text-[13px]"
              >
                {step.done ? (
                  <CircleCheck
                    size={15}
                    style={{ color: "var(--fill-blue)" }}
                    className="shrink-0"
                  />
                ) : (
                  <span
                    className="size-[15px] shrink-0 rounded-full border"
                    style={{ borderColor: "var(--fill-divider)" }}
                  />
                )}
                <span
                  style={{
                    color: step.done
                      ? "var(--text-secondary)"
                      : "var(--text-primary)",
                  }}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- Approval ---------- */

const approvalOutcome = {
  approved: {
    label: "Approved",
    color: "var(--fill-green)",
    Icon: CircleCheck,
  },
  denied: { label: "Denied", color: "var(--fill-red)", Icon: CircleAlert },
  timed_out: {
    label: "Timed out",
    color: "var(--icon-secondary)",
    Icon: CircleAlert,
  },
} as const;

export function ApprovalCard({
  approval,
  place = alone,
  actions,
}: {
  approval: Approval;
  place?: Place;
  actions: Actions;
}) {
  return (
    <div {...shell(place, "w-full max-w-[340px] p-4")}>
      <div className="flex items-start gap-3">
        {/* an app's action shows the app, as its Connect card does */}
        {approval.app ? (
          <AppLogo
            name={approval.app}
            logo={providerLogo(approval.app)}
            size={36}
          />
        ) : (
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              background: "var(--fill-primary)",
              color: "var(--icon-primary)",
            }}
          >
            <ShieldCheck size={18} />
          </span>
        )}
        <div className="min-w-0">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {approval.action}
          </p>
          <p
            className="truncate text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {approval.target}
          </p>
        </div>
      </div>
      {/* one "Field: value" a line; a long one scrolls inside the card */}
      <p
        className="mt-2.5 max-h-48 overflow-y-auto whitespace-pre-line text-[13px] leading-snug [overflow-wrap:anywhere]"
        style={{ color: "var(--text-secondary)" }}
      >
        {approval.detail}
      </p>
      {approval.status === "pending" ? (
        <>
          {/* three answers: this once, always (only where a rule can hold it: app actions), or no */}
          {/* one under another: three side by side were cramped on a phone */}
          <div className="mt-3 flex flex-col gap-2">
            <button
              className="h-10 w-full rounded-full text-[15px] font-semibold text-white"
              style={{ background: "var(--fill-blue)" }}
              onClick={() => actions.resolveApproval(approval.id, "allow_once")}
            >
              Allow once
            </button>
            {approval.remember && (
              <button
                className="h-10 w-full rounded-full text-[15px] font-semibold"
                style={{
                  background: "var(--fill-card-button)",
                  color: "var(--fill-blue)",
                }}
                onClick={() =>
                  actions.resolveApproval(approval.id, "allow_always")
                }
              >
                Always allow
              </button>
            )}
            <button
              className="h-10 w-full rounded-full text-[15px] font-semibold"
              style={{
                background: "var(--fill-card-button)",
                color: "var(--text-primary)",
              }}
              onClick={() => actions.resolveApproval(approval.id, "deny")}
            >
              Deny
            </button>
          </div>
        </>
      ) : (
        <Outcome {...approvalOutcome[approval.status]} />
      )}
    </div>
  );
}

function Outcome({
  label,
  color,
  Icon,
}: {
  label: string;
  color: string;
  Icon: typeof CircleCheck;
}) {
  return (
    <div
      className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold"
      style={{ background: "var(--fill-card-button)", color }}
    >
      <Icon size={14} />
      {label}
    </div>
  );
}

/* ---------- Connection request ---------- */

/**
 * Muse connection request (ref 52-connreq-desktop): compact card, white tile
 * with the app glyph, name + "Connector", and a neutral Connect pill.
 */
export function ConnectionCard({
  connection,
  place = alone,
  actions,
}: {
  connection: Connection;
  place?: Place;
  actions: Actions;
}) {
  const label = {
    pending: "Connect",
    connected: "Connected",
    dismissed: "Not now",
  }[connection.status];
  return (
    <div {...shell(place, "w-full max-w-[260px] p-2.5", 18)}>
      <div className="flex items-center gap-2.5 px-0.5 pt-0.5">
        <AppLogo
          name={connection.title}
          logo={providerLogo(connection.provider)}
          size={40}
        />
        <div className="min-w-0">
          <p
            className="truncate text-[14px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {connection.title}
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            Connector
          </p>
        </div>
      </div>
      <button
        disabled={connection.status !== "pending"}
        className="mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full text-[14px] font-medium"
        style={{
          background: "var(--fill-card-button)",
          color:
            connection.status === "connected"
              ? "var(--fill-green)"
              : "var(--text-primary)",
        }}
        onClick={() => actions.openExplainer(connection.id)}
      >
        {connection.status === "connected" && <Check size={15} />}
        {label}
      </button>
    </div>
  );
}

/* ---------- Failure ---------- */

const failed: Record<Failure["reason"], string> = {
  refused: "The model's provider refused this reply (its content filter).",
  failed: "The model's service had a problem.",
};

/** Muse could not reply: a notice of its own (not Muse's words), with the provider's words and a way to try again. */
export function FailureCard({
  failure,
  place = alone,
  actions,
}: {
  failure: Failure;
  place?: Place;
  actions: Actions;
}) {
  return (
    <div {...shell(place, "w-full max-w-[340px] px-4 py-3", 18)} role="status">
      <div className="flex items-start gap-2.5">
        <CircleAlert
          size={18}
          className="mt-0.5 shrink-0"
          style={{ color: "var(--fill-orange)" }}
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-[14px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Amuse couldn't reply
          </p>
          <p
            className="mt-0.5 text-[13px] leading-snug"
            style={{ color: "var(--text-secondary)" }}
          >
            {failed[failure.reason]}
          </p>
          <details className="mt-1">
            <summary
              className="cursor-pointer text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              Details
            </summary>
            <p
              className="mt-1 break-words text-[12px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {failure.detail}
            </p>
          </details>
        </div>
      </div>
      {failure.status === "open" ? (
        <button
          className="hover-fade mt-2.5 h-8 w-full rounded-full text-[14px] font-medium"
          style={{
            background: "var(--fill-card-button)",
            color: "var(--text-primary)",
          }}
          onClick={() => actions.retry(failure.id)}
        >
          Try again
        </button>
      ) : (
        <p
          className="mt-2 text-[12px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Tried again
        </p>
      )}
    </div>
  );
}

/* ---------- Schedule ---------- */

/** Work the agent set up for later: what, when, and what is next; managed in Settings › Schedules. */
export function ScheduleCard({
  schedule,
  place = alone,
  actions,
}: {
  schedule: Schedule;
  place?: Place;
  actions: Actions;
}) {
  const over = schedule.status === "done" || schedule.status === "cancelled";
  return (
    <button
      {...shell(
        place,
        "flex w-full max-w-[320px] items-center gap-3 p-3 text-left",
        18,
      )}
      aria-label={`Schedule: ${schedule.title}`}
      onClick={() => actions.openSettings("schedules")}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: "var(--fill-card-button)",
          color: over ? "var(--icon-secondary)" : "var(--fill-blue)",
        }}
      >
        <CalendarClock size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[14px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {schedule.title}
        </span>
        <span
          className="block truncate text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {repeats(schedule.when)}
        </span>
        <span
          className="block truncate text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {scheduleState(schedule)}
        </span>
      </span>
      <ChevronRight size={16} style={{ color: "var(--icon-secondary)" }} />
    </button>
  );
}

/* ---------- Browser run ---------- */

/** A sketch of a page, for the demo or when the real page is gone. */
function Sketch({ id }: { id: string }) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div
        className="h-2.5 w-1/3 rounded-sm"
        style={{ background: `hsl(${hue(id)} 40% 80%)` }}
      />
      <div
        className="h-2 w-1/2 rounded-sm"
        style={{ background: "var(--fill-tertiary)" }}
      />
      <div
        className="h-2 w-2/5 rounded-sm"
        style={{ background: "var(--fill-tertiary)" }}
      />
    </div>
  );
}

/**
 * The real page, refreshed every few seconds while the run is in flight.
 * Until a frame loads (the page may not be open yet) the sketch shows; every
 * refresh tries again.
 */
function Thumbnail({
  src,
  live,
  id,
}: {
  src: string;
  live: boolean;
  id: string;
}) {
  const [tick, setTick] = useState(0);
  /** loading: the first screenshot is on its way; missing: none to be had, so a sketch stands in */
  const [shot, setShot] = useState<"loading" | "shown" | "missing">("loading");
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, [live]);
  return (
    <div className="relative h-full w-full">
      {shot === "loading" && <div className="skeleton absolute inset-0" />}
      {shot === "missing" && <Sketch id={id} />}
      <img
        alt=""
        src={`${src}&t=${tick}`}
        className="absolute inset-0 h-full w-full object-cover object-top"
        style={{ visibility: shot === "shown" ? "visible" : "hidden" }}
        onError={() => setShot("missing")} // the next refresh tries again
        onLoad={() => setShot("shown")}
      />
    </div>
  );
}

/** A browser's page, small: the real one where a server has it (kept fresh while `live`), else a sketch. */
export function PagePreview({
  id,
  thumb,
  live,
}: {
  id: string;
  thumb: ((id: string) => string) | null;
  live: boolean;
}) {
  return thumb ? (
    <Thumbnail src={thumb(id)} live={live} id={id} />
  ) : (
    <Sketch id={id} />
  );
}

/**
 * A run whose browser is gone: only a record of it. No page, nothing to open
 * (a button there would lead nowhere).
 */
function EndedBrowserCard({
  browser,
  place,
}: {
  browser: Browser;
  place: Place;
}) {
  return (
    <div {...shell(place, "flex w-full max-w-[314px] items-center gap-3 p-4")}>
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
        style={{
          background: "var(--fill-primary)",
          color: "var(--icon-secondary)",
        }}
      >
        <Globe size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="text-[14px] font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          Browser
        </p>
        <p
          className="truncate text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {browserLook(browser).label} · {browser.title}
        </p>
      </div>
    </div>
  );
}

/**
 * Muse browser card: tinted globe tile + "Browser" + "<status> · <task>", a
 * page thumbnail, and one pill button. Refs 06-card-desktop, 02-run-*, 08-now.
 */
export function BrowserCard({
  browser,
  thumb,
  place = alone,
  actions,
}: {
  browser: Browser;
  thumb: ((id: string) => string) | null;
  place?: Place;
  actions: Actions;
}) {
  const meta = browserLook(browser);
  const open = () => actions.openViewer(browser.id);
  if (!browser.live)
    return <EndedBrowserCard browser={browser} place={place} />;
  return (
    <div {...shell(place, "w-full max-w-[314px] p-4")}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            background: `color-mix(in srgb, ${meta.color} 12%, var(--fill-primary))`,
            color: meta.color,
          }}
        >
          <Globe size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[14px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Browser
          </p>
          <p
            className="truncate text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {meta.label} · {browser.title}
          </p>
        </div>
      </div>

      <button
        aria-label="Open browser viewer"
        className="mt-3 block h-[178px] w-full overflow-hidden rounded-[10px] text-left"
        style={{
          background: "var(--fill-primary)",
          border: "1px solid var(--fill-divider)",
        }}
        onClick={open}
      >
        {thumb ? (
          <Thumbnail
            src={thumb(browser.id)}
            live={bannerActive(browser)}
            id={browser.id}
          />
        ) : (
          <Sketch id={browser.id} />
        )}
      </button>

      <button
        className="mt-3 h-9 w-full rounded-full text-[14px] font-medium"
        style={{
          background: "var(--fill-card-button)",
          color: "var(--text-primary)",
        }}
        onClick={open}
      >
        Open browser
      </button>
    </div>
  );
}
