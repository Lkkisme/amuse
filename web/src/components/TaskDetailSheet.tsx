/**
 * Task detail sheet, opened from the chevron on a task card (shared Sheet
 * shell: bottom sheet on mobile, centered on sm+): status, every step, and
 * Stop while the task is still running.
 */
import { Button } from "./Button";
import { RichText } from "./markdown";
import { CircleCheck } from "lucide-react";
import type { State } from "@amuse/protocol";
import type { Actions } from "../ui.ts";
import { byId, taskStatus } from "../view.ts";
import { Sheet } from "./Sheet";
import { useLastValue } from "./usePresence";
import { useT } from "../i18n/react.ts";

export function TaskDetailSheet({
  conversation,
  open,
  actions,
}: {
  conversation: State;
  open: string | null;
  actions: Actions;
}) {
  const t = useT();
  // keep showing the last task while the sheet animates out
  const task = byId(conversation, "task", useLastValue(open));
  if (!task) return null;
  const close = () => actions.openTaskDetail(null);
  const meta = taskStatus(task.status, t);
  const running =
    task.status === "queued" ||
    task.status === "working" ||
    task.status === "waiting";

  return (
    <Sheet open={open !== null} onClose={close} wide>
      <div className="overflow-y-auto px-6 pb-6 pt-4">
        <p
          className="pr-8 text-[20px] font-semibold leading-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {task.title}
        </p>
        <p
          className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium"
          style={{ color: meta.color }}
        >
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ background: meta.color }}
          />
          {meta.label}
        </p>

        {/* what it came back with: here even when Muse could not pass it on */}
        {task.result !== null && (
          <>
            <p
              className="mt-5 text-[13px] font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              {t.task.result}
            </p>
            <div
              className="mt-1.5 text-[15px] leading-[22px]"
              style={{ color: "var(--text-primary)" }}
            >
              <RichText text={task.result} />
            </div>
          </>
        )}

        {task.steps.length > 0 && (
          <p
            className="mt-5 text-[13px] font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.task.steps}
          </p>
        )}
        <ul className="mt-2 space-y-2.5">
          {task.steps.map((step) => (
            <li
              key={step.label}
              className="flex items-center gap-2.5 text-[15px]"
            >
              {step.done ? (
                <CircleCheck
                  size={17}
                  style={{ color: "var(--fill-blue)" }}
                  className="shrink-0"
                />
              ) : (
                <span
                  className="size-[17px] shrink-0 rounded-full border"
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

        {task.instructions && (
          <>
            <p
              className="mt-5 text-[13px] font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              {t.task.asked}
            </p>
            <p
              className="mt-1.5 whitespace-pre-wrap text-[14px] leading-snug"
              style={{ color: "var(--text-secondary)" }}
            >
              {task.instructions}
            </p>
          </>
        )}

        {running && (
          <Button
            size="lg"
            tone="danger"
            className="mt-6"
            onClick={() => {
              actions.stopTask(task.id);
              close();
            }}
          >
            {t.task.stop}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
