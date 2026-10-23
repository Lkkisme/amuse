/**
 * The "Are you sure?" sheet: what is about to happen, a red action that does it
 * and Cancel. Sign out, reset, remove. `busy` holds the action while it runs.
 */
import type { LucideIcon } from "lucide-react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { useT } from "../i18n/react.ts";

export function ConfirmSheet({
  open,
  onClose,
  icon: Icon,
  title,
  body,
  action,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** a picture for the thing, when there is one */
  icon?: LucideIcon;
  title: string;
  body: string;
  /** the danger button's label: what it does */
  action: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} bare>
      <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
        {Icon && (
          <span
            className="flex size-14 items-center justify-center rounded-[16px]"
            style={{ background: "#ffffff", color: "#111112" }}
          >
            <Icon size={26} />
          </span>
        )}
        <p
          className={`${Icon ? "mt-4" : "mt-2"} text-[20px] font-semibold`}
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {body}
        </p>
        <Button variant="danger" size="lg" className="mt-6" disabled={busy} onClick={onConfirm}>
          {action}
        </Button>
        <Button variant="plain" size="lg" className="mt-2" onClick={onClose}>
          {t.common.cancel}
        </Button>
      </div>
    </Sheet>
  );
}
