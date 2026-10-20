/**
 * Cards in the chat feed: one component per non-message entity kind.
 * Props are protocol entities; behavior goes through Actions.
 */
import { Check, ChevronRight, CircleAlert, CircleCheck, Globe, ListTodo, ShieldCheck, Table } from "lucide-react";
import type { Approval, Browser, Connection, Task } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { useEffect, useState } from "react";
import { bannerActive, browserStatus, hue, taskStatus } from "../view.ts";

const CARD_BG = "var(--fill-secondary)";

/* ---------- Task ---------- */

export function TaskCard({ task, actions }: { task: Task; actions: Actions }) {
  const meta = taskStatus[task.status];
  const done = task.steps.filter((s) => s.done).length;
  return (
    <div className="w-full max-w-[340px] rounded-2xl p-4" style={{ background: CARD_BG }}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "var(--fill-primary)", color: "var(--icon-primary)" }}
        >
          <ListTodo size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
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
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: meta.color }}>
            <span className="inline-block size-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </span>
        </div>
      </div>

      {task.steps.length > 0 && (
        <div className="mt-3">
          <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--fill-tertiary)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(done / task.steps.length) * 100}%`, background: "var(--fill-blue)" }}
            />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {task.steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2 text-[13px]">
                {step.done ? (
                  <CircleCheck size={15} style={{ color: "var(--fill-blue)" }} className="shrink-0" />
                ) : (
                  <span className="size-[15px] shrink-0 rounded-full border" style={{ borderColor: "var(--fill-divider)" }} />
                )}
                <span style={{ color: step.done ? "var(--text-secondary)" : "var(--text-primary)" }}>{step.label}</span>
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
  approved: { label: "Approved", color: "var(--fill-green)", Icon: CircleCheck },
  denied: { label: "Denied", color: "var(--fill-red)", Icon: CircleAlert },
  timed_out: { label: "Timed out", color: "var(--icon-secondary)", Icon: CircleAlert },
} as const;

export function ApprovalCard({ approval, actions }: { approval: Approval; actions: Actions }) {
  return (
    <div className="w-full max-w-[340px] rounded-2xl p-4" style={{ background: CARD_BG }}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "var(--fill-primary)", color: "var(--icon-primary)" }}
        >
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {approval.action}
          </p>
          <p className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {approval.target}
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        {approval.detail}
      </p>
      {approval.status === "pending" ? (
        <>
          <div className="mt-3 flex gap-2">
            <button
              className="h-9 flex-1 rounded-full text-[14px] font-semibold text-white"
              style={{ background: "var(--fill-blue)" }}
              onClick={() => actions.resolveApproval(approval.id, "allow_once")}
            >
              Allow
            </button>
            <button
              className="h-9 flex-1 rounded-full text-[14px] font-semibold"
              style={{ background: "var(--fill-card-button)", color: "var(--text-primary)" }}
              onClick={() => actions.resolveApproval(approval.id, "deny")}
            >
              Deny
            </button>
          </div>
          <button
            className="hover-fade mx-auto mt-2 block text-[13px] font-medium"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => actions.resolveApproval(approval.id, "allow_always")}
          >
            Always allow
          </button>
        </>
      ) : (
        <Outcome {...approvalOutcome[approval.status]} />
      )}
    </div>
  );
}

function Outcome({ label, color, Icon }: { label: string; color: string; Icon: typeof CircleCheck }) {
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
export function ConnectionCard({ connection, actions }: { connection: Connection; actions: Actions }) {
  const label = { pending: "Connect", connected: "Connected", dismissed: "Not now" }[connection.status];
  return (
    <div className="w-full max-w-[260px] rounded-[18px] p-2.5" style={{ background: CARD_BG }}>
      <div className="flex items-center gap-2.5 px-0.5 pt-0.5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "#ffffff", color: "#16a34a", boxShadow: "0 0 0 1px var(--fill-divider)" }}
        >
          <Table size={20} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
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
          color: connection.status === "connected" ? "var(--fill-green)" : "var(--text-primary)",
        }}
        onClick={() => actions.openExplainer(connection.id)}
      >
        {connection.status === "connected" && <Check size={15} />}
        {label}
      </button>
    </div>
  );
}

/* ---------- Browser run ---------- */

/** A sketch of a page, for the demo or when the real page is gone. */
function Sketch({ id }: { id: string }) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="h-2.5 w-1/3 rounded-sm" style={{ background: `hsl(${hue(id)} 40% 80%)` }} />
      <div className="h-2 w-1/2 rounded-sm" style={{ background: "var(--fill-tertiary)" }} />
      <div className="h-2 w-2/5 rounded-sm" style={{ background: "var(--fill-tertiary)" }} />
    </div>
  );
}

/**
 * The real page, refreshed every few seconds while the run is in flight.
 * Until a frame loads (the page may not be open yet) the sketch shows; every
 * refresh tries again.
 */
function Thumbnail({ src, live, id }: { src: string; live: boolean; id: string }) {
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, [live]);
  return (
    <div className="relative h-full w-full">
      {!shown && <Sketch id={id} />}
      <img
        alt=""
        src={`${src}&t=${tick}`}
        className="absolute inset-0 h-full w-full object-cover object-top"
        style={{ visibility: shown ? "visible" : "hidden" }}
        onError={() => setShown(false)}
        onLoad={() => setShown(true)}
      />
    </div>
  );
}

/**
 * Muse browser card: tinted globe tile + "Browser" + "<status> · <task>", a
 * page thumbnail, and one pill button. Refs 06-card-desktop, 02-run-*, 08-now.
 */
export function BrowserCard({ browser, thumb, actions }: { browser: Browser; thumb: ((id: string) => string) | null; actions: Actions }) {
  const meta = browserStatus[browser.status];
  const open = () => actions.openViewer(browser.id);
  return (
    <div className="w-full max-w-[314px] rounded-[22px] p-4" style={{ background: CARD_BG }}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{ background: `color-mix(in srgb, ${meta.color} 12%, var(--fill-primary))`, color: meta.color }}
        >
          <Globe size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
            Browser
          </p>
          <p className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {meta.label} · {browser.title}
          </p>
        </div>
      </div>

      <button
        aria-label="Open browser viewer"
        className="mt-3 block h-[178px] w-full overflow-hidden rounded-[10px] text-left"
        style={{ background: "var(--fill-primary)", border: "1px solid var(--fill-divider)" }}
        onClick={open}
      >
        {thumb ? <Thumbnail src={thumb(browser.id)} live={bannerActive(browser)} id={browser.id} /> : <Sketch id={browser.id} />}
      </button>

      <button
        className="mt-3 h-9 w-full rounded-full text-[14px] font-medium"
        style={{ background: "var(--fill-card-button)", color: "var(--text-primary)" }}
        onClick={open}
      >
        {browser.status === "working" || browser.status === "queued" ? "Open browser" : "Open preview"}
      </button>
    </div>
  );
}
