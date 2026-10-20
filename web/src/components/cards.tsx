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
  Loader,
  ShieldCheck,
  Table,
} from "lucide-react";
import type { Approval, BrowserRun, ConnectionRequest, Task, TaskStatus } from "../data/fakeMuse";
import { taskStatusMeta } from "../data/fakeMuse";
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
            <button aria-label="Open task details" className="shrink-0 rounded p-0.5" style={{ color: "var(--icon-secondary)" }}>
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

export function ConnReqCard({ connreq, actions }: { connreq: ConnectionRequest; actions: MuseActions }) {
  const connected = connreq.status === "connected";
  const dismissed = connreq.status === "dismissed";
  return (
    <div className="w-full max-w-[340px] rounded-2xl p-4" style={{ background: CARD_BG }}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-white"
          style={{ background: "var(--fill-blue)" }}
        >
          <Table size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {connreq.app}
          </p>
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            Connector
          </p>
        </div>
      </div>
      <p className="mt-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
        {connreq.capability}
      </p>
      <button
        disabled={connected || dismissed}
        className="mt-3 h-10 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-90"
        style={{ background: connected ? "var(--fill-green)" : "var(--fill-blue)" }}
        onClick={() => actions.requestConnect(connreq.id)}
      >
        {connected ? (
          <span className="inline-flex items-center gap-1.5">
            <Check size={16} /> Connected
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

export function BrowserCard({ browser, actions }: { browser: BrowserRun; actions: MuseActions }) {
  const working = browser.status === "working";
  return (
    <div className="w-full max-w-[420px] rounded-2xl p-3" style={{ background: CARD_BG }}>
      <div className="flex items-center gap-2.5 px-1 pb-2 pt-1">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: "var(--fill-primary)", color: "var(--icon-primary)" }}
        >
          <Globe size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Browser
          </p>
          <p className="flex items-center gap-1 truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {working && <Loader size={11} className="animate-spin" />}
            {taskStatusMeta[browser.status].label} · {browser.site}
          </p>
        </div>
      </div>

      {/* thumbnail placeholder — never a real page, just a sketched canvas */}
      <button
        aria-label="Open browser viewer"
        className="block w-full overflow-hidden rounded-xl text-left"
        style={{ background: "var(--fill-primary)" }}
        onClick={() => actions.openViewer(browser.id)}
      >
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: "1px solid var(--fill-divider)" }}>
          <span className="size-2 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
          <span className="size-2 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
          <span className="size-2 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
          <span
            className="ml-2 flex-1 truncate rounded-full px-2.5 py-0.5 text-[11px]"
            style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}
          >
            {browser.site}
          </span>
        </div>
        <div className="flex h-32 flex-col justify-end gap-2 p-3" style={{ background: `hsl(${browser.thumbnailHue} 45% 96%)` }}>
          <div className="h-3 w-2/3 rounded" style={{ background: `hsl(${browser.thumbnailHue} 45% 78%)` }} />
          <div className="h-2 w-1/2 rounded" style={{ background: `hsl(${browser.thumbnailHue} 30% 85%)` }} />
          <div className="h-2 w-3/4 rounded" style={{ background: `hsl(${browser.thumbnailHue} 30% 85%)` }} />
        </div>
      </button>

      <button
        className="mt-2 h-10 w-full rounded-full text-[15px] font-semibold"
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)" }}
        onClick={() => actions.openViewer(browser.id)}
      >
        Open preview
      </button>
    </div>
  );
}
