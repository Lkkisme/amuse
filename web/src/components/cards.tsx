/**
 * Inline card system rendered inside the chat feed, per docs/ui-spec.md
 * surfaces 2 (task runs), 3 (form request), 10 (connection request) and 4
 * (browser run card). Fake state only; all behavior arrives via MuseActions.
 */
import { useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Globe,
  ListTodo,
  ShieldCheck,
  Table,
} from "lucide-react";
import type { Approval, BrowserRun, ConnectionRequest, Task, TaskStatus } from "../data/fakeMuse";
import { browserStatusMeta, taskStatusMeta } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

const CARD_BG = "var(--fill-secondary)";

function StatusChip({ status }: { status: TaskStatus }) {
  const meta = taskStatusMeta[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: meta.color }}>
      <span className="inline-block size-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

/* ---------- Task card (surfaces 2 + 3) ---------- */

export function TaskCard({ task, actions }: { task: Task; actions: MuseActions }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((task.form ?? []).map((f) => [f.field, f.value])),
  );
  const doneCount = task.steps.filter((s) => s.done).length;
  const showForm = task.status === "waiting_input" && task.form && task.form.length > 0;

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
          <div className="mt-0.5">
            <StatusChip status={task.status} />
          </div>
        </div>
      </div>

      {/* step progress */}
      <div className="mt-3">
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--fill-tertiary)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${(doneCount / task.steps.length) * 100}%`, background: "var(--fill-blue)" }}
          />
        </div>
        <ul className="mt-2.5 space-y-1.5">
          {task.steps.map((step) => (
            <li key={step.label} className="flex items-center gap-2 text-[13px]">
              {step.done ? (
                <CircleCheck size={15} style={{ color: "var(--fill-blue)" }} className="shrink-0" />
              ) : (
                <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full border" style={{ borderColor: "var(--fill-divider)" }} />
              )}
              <span style={{ color: step.done ? "var(--text-secondary)" : "var(--text-primary)" }}>{step.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* inline form (surface 3) */}
      {showForm && (
        <form
          className="mt-3 space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            actions.submitTaskForm(task.id, values);
          }}
        >
          {(task.form ?? []).map((f) => (
            <label key={f.field} className="block">
              <span className="mb-1 block text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {f.label}
              </span>
              <input
                className="w-full rounded-[10px] border-0 px-3 py-2 text-[14px] outline-none"
                style={{ background: "var(--fill-primary)", color: "var(--text-primary)" }}
                value={values[f.field] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.field]: e.target.value }))}
                placeholder="Type an answer…"
              />
            </label>
          ))}
          <button
            type="submit"
            className="w-full rounded-full py-2 text-[14px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
          >
            Submit
          </button>
        </form>
      )}
    </div>
  );
}

/* ---------- Approval card ---------- */

export function ApprovalCard({ approval, actions }: { approval: Approval; actions: MuseActions }) {
  const pending = approval.status === "pending";
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
            {approval.verb}
          </p>
          <p className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {approval.target}
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        {approval.detail}
      </p>
      {pending ? (
        <div className="mt-3 flex gap-2">
          <button
            className="h-9 flex-1 rounded-full text-[14px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => actions.resolveApproval(approval.id, true)}
          >
            Approve
          </button>
          <button
            className="h-9 flex-1 rounded-full text-[14px] font-semibold"
            style={{ background: "var(--fill-primary)", color: "var(--text-primary)" }}
            onClick={() => actions.resolveApproval(approval.id, false)}
          >
            Deny
          </button>
        </div>
      ) : (
        <div
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold"
          style={{
            background: "var(--fill-primary)",
            color: approval.status === "approved" ? "var(--fill-green)" : "var(--fill-red)",
          }}
        >
          {approval.status === "approved" ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
          {approval.status === "approved" ? "Approved" : "Denied"}
        </div>
      )}
    </div>
  );
}

/* ---------- Connection request card (surface 10) ---------- */

/**
 * Muse connection request (ref 52-connreq-desktop): compact card, white tile
 * with the app glyph, name + "Connector", and a neutral Connect pill. No blue.
 */
export function ConnReqCard({ connreq, actions }: { connreq: ConnectionRequest; actions: MuseActions }) {
  const connected = connreq.status === "connected";
  const dismissed = connreq.status === "dismissed";
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
            {connreq.app}
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            Connector
          </p>
        </div>
      </div>
      <button
        disabled={connected || dismissed}
        className="mt-2.5 h-9 w-full rounded-full text-[14px] font-medium"
        style={{ background: "var(--fill-card-button)", color: connected ? "var(--fill-green)" : "var(--text-primary)" }}
        onClick={() => actions.requestConnect(connreq.id)}
      >
        {connected ? (
          <span className="inline-flex items-center gap-1.5">
            <Check size={15} /> Connected
          </span>
        ) : dismissed ? (
          "Not now"
        ) : (
          "Connect"
        )}
      </button>
    </div>
  );
}

/* ---------- Browser run card (surface 4) ---------- */

/**
 * Muse browser card: tinted globe tile + "Browser" + "<status> · <task>", a
 * page thumbnail, and one pill button. Blue = working, orange = waiting for
 * you (needs help), green = completed. Refs 06-card-desktop, 02-run-*, 08-now.
 */
export function BrowserCard({ browser, actions }: { browser: BrowserRun; actions: MuseActions }) {
  const meta = browserStatusMeta[browser.status];
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

      {/* thumbnail: a sketch of the page, never a real one */}
      <button
        aria-label="Open browser viewer"
        className="mt-3 flex h-[178px] w-full flex-col gap-2 overflow-hidden rounded-[10px] p-3 text-left"
        style={{ background: "var(--fill-primary)", border: "1px solid var(--fill-divider)" }}
        onClick={open}
      >
        <div className="h-2.5 w-1/3 rounded-sm" style={{ background: `hsl(${browser.thumbnailHue} 40% 80%)` }} />
        <div className="h-2 w-1/2 rounded-sm" style={{ background: "var(--fill-tertiary)" }} />
        <div className="h-2 w-2/5 rounded-sm" style={{ background: "var(--fill-tertiary)" }} />
      </button>

      <button
        className="mt-3 h-9 w-full rounded-full text-[14px] font-medium"
        style={{ background: "var(--fill-card-button)", color: "var(--text-primary)" }}
        onClick={open}
      >
        {browser.status === "working" ? "Open browser" : "Open preview"}
      </button>
    </div>
  );
}
