/**
 * Task detail sheet, opened from the chevron on a task card (shared Sheet
 * shell: bottom sheet on mobile, centered on sm+). Shows the
 * status, every step, and the answers given so far.
 */
import { CircleCheck } from "lucide-react";
import type { DemoState } from "../data/fakeMuse";
import { findTask, taskStatusMeta } from "../data/fakeMuse";
import type { MuseActions } from "./actions";
import { Sheet } from "./Sheet";
import { useLastValue } from "./usePresence";

export function TaskDetailSheet({ state, actions }: { state: DemoState; actions: MuseActions }) {
  // keep showing the last task while the sheet animates out
  const taskId = useLastValue(state.taskDetail);
  const task = taskId ? findTask(state.feed, taskId) : undefined;
  if (!task) return null;
  const close = () => actions.openTaskDetail(null);
  const meta = taskStatusMeta[task.status];
  const answers = (task.form ?? []).filter((f) => f.value);

  return (
    <Sheet open={state.taskDetail !== null} onClose={close}>
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
    </Sheet>
  );
}
