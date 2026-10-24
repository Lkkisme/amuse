/**
 * One error system, three sizes of the same thing: an icon, a message, and what can be done about it.
 *
 * - `ErrorToast`: an action failed (voice, saving, connecting). Floats above the composer, hides itself.
 * - `ErrorState`: a page could not load. Takes the place of its content, in the empty state's style.
 * - `ErrorBanner`: part of a section failed and the rest works. A compact row at the section's top.
 *
 * All take `message` (what the user reads), `detail` (code, feature, provider, time: goes to the agent when the user
 * asks Amuse, never shown), and `retry` (only where trying again makes sense). "Ask Amuse" is built in, so a page that
 * shows one of these cannot forget it. A validation error under a field is none of these: it stays small text, and
 * the user just fixes the input.
 */
import { useContext, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { AskContext } from "../ask.tsx";
import { Button } from "./Button";
import { useT } from "../i18n/react.ts";

/** The icon's colour: neutral for now (the owner has not chosen); set to "var(--fill-red)" to bring red back everywhere. */
const ICON = "var(--icon-secondary)";

interface ErrorProps {
  message: string;
  detail: string;
  retry?: () => void;
  /** after the action is taken (the toast closes) */
  onAct?: () => void;
}

/** 「重试」 (a grey pill, when retrying makes sense) and 「问 Amuse」 (blue words, quieter). */
function Actions({ message, detail, retry, onAct, onCard = false, className = "" }: ErrorProps & { onCard?: boolean; className?: string }) {
  const t = useT();
  const ask = useContext(AskContext);
  return (
    <div className={`flex items-center gap-1 ${className}`} onClick={(e) => e.stopPropagation()}>
      {retry && (
        <Button
          onCard={onCard}
          onClick={() => {
            onAct?.();
            retry();
          }}
        >
          {t.ask.retry}
        </Button>
      )}
      <Button variant="plain" tone="accent" onClick={() => ask({ message, detail })}>
        {t.ask.action}
      </Button>
    </div>
  );
}

/** A failed action, floating above the composer (and above Settings and sheets, which cover the chat): icon, message, actions below on the right. */
export function ErrorToast({ message, detail, retry, onClose }: Omit<ErrorProps, "onAct"> & { onClose: () => void }) {
  return (
    <div
      role="status"
      onClick={onClose}
      className={`anim-fade-in inset-x-4 bottom-[86px] mx-auto w-fit max-w-[min(100%,420px)] rounded-[20px] py-3 pl-4 pr-3 fixed z-[90]`}
      style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert size={18} className="mt-px shrink-0" style={{ color: ICON }} />
        <p className="min-w-0 pr-1 text-[14px] leading-[20px]" style={{ color: "var(--text-primary)" }}>
          {message}
        </p>
      </div>
      <Actions message={message} detail={detail} {...(retry ? { retry } : {})} onAct={onClose} onCard className="-mb-1 mt-1 justify-end" />
    </div>
  );
}

/** A page that could not load: in place of its content, in the empty state's style (a card on the page's own grey). */
export function ErrorState({ title, message, detail, retry }: ErrorProps & { title: string }) {
  return (
    <div role="alert" className="mt-4 flex flex-col items-center rounded-[18px] px-5 py-8 text-center" style={{ background: "var(--fill-secondary)" }}>
      <span className="flex size-11 items-center justify-center rounded-full" style={{ background: "var(--fill-primary)" }}>
        <CircleAlert size={22} style={{ color: ICON }} />
      </span>
      <p className="mt-3 text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      <p className="mt-1 max-w-[300px] text-[14px] leading-[20px]" style={{ color: "var(--text-secondary)" }}>
        {message}
      </p>
      <Actions message={`${title}: ${message}`} detail={detail} {...(retry ? { retry } : {})} onCard className="mt-4" />
    </div>
  );
}

/** Part of a section failed and the rest works: a compact row at its top. */
export function ErrorBanner({ message, detail, retry, children }: ErrorProps & { children?: ReactNode }) {
  return (
    <div role="alert" className="mt-3 rounded-[16px] py-3 pl-4 pr-2" style={{ background: "var(--fill-secondary)" }}>
      <div className="flex items-start gap-2.5">
        <CircleAlert size={18} className="mt-px shrink-0" style={{ color: ICON }} />
        <p className="min-w-0 pr-2 text-[14px] leading-[20px]" style={{ color: "var(--text-primary)" }}>
          {message}
        </p>
      </div>
      {children}
      <Actions message={message} detail={detail} {...(retry ? { retry } : {})} onCard className="-mb-1 mt-1 justify-end" />
    </div>
  );
}
