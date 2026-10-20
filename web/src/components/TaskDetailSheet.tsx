/**
 * Task detail sheet, opened from the chevron on a task card. Same shell as
 * the connect explainer: bottom sheet on mobile, centered on sm+. Shows the
 * status, every step, and the answers given so far.
 */
import { CircleCheck, X } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import { findTask, taskStatusMeta } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

export function TaskDetailSheet({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const task = state.taskDetail ? findTask(state.feed, state.taskDetail) : undefined;
  if (!task) return null;
  const close = () => actions.openTaskDetail(null);
  const meta = taskStatusMeta[task.status];
  const answers = (task.form ?? []).filter((f) => f.value);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div
        className="anim-modal-in relative flex max-h-[92vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--chat-background)", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}
      >
        <div className="flex shrink-0 justify-center pt-2.5">
          <span className="h-1.5 w-9 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
        </div>
        <button
          aria-label="Close"
          className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full"
          style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
          onClick={close}
        >
          <X size={16} />
        </button>

        <div className="overflow-y-auto px-6 pb-6 pt-4">
          <p className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
            {task.title}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: meta.color }}>
            <span className="inline-block size-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </p>

          <p className="mt-5 text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            Steps
          </p>
          <ul className="mt-2 space-y-2.5">
            {task.steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2.5 text-[15px]">
                {step.done ? (
                  <CircleCheck size={17} style={{ color: "var(--fill-blue)" }} className="shrink-0" />
                ) : (
                  <span className="size-[17px] shrink-0 rounded-full border" style={{ borderColor: "var(--fill-divider)" }} />
                )}
                <span style={{ color: step.done ? "var(--text-secondary)" : "var(--text-primary)" }}>{step.label}</span>
              </li>
            ))}
          </ul>

          {answers.length > 0 && (
            <>
              <p className="mt-5 text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                Your answers
              </p>
              <dl className="mt-2 space-y-2">
                {answers.map((f) => (
                  <div key={f.field} className="rounded-xl px-3 py-2" style={{ background: "var(--fill-secondary)" }}>
                    <dt className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                      {f.label}
                    </dt>
                    <dd className="text-[15px]" style={{ color: "var(--text-primary)" }}>
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
