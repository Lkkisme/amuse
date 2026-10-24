import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { splitDetail } from "../approval.ts";
import { useT } from "../i18n/react.ts";
import { InfoRow, groupClass } from "./SecretFields";

/** A quiet text link: a card's own words for what is behind it. */
const link = "hover-fade inline-flex items-center gap-0.5 text-[13px] font-medium";

/** The reason, to three lines with "more" (a long one is read in full in place, never in a box that scrolls). */
function Reason({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const words = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = words.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div className="mt-2.5">
      <p
        ref={words}
        className={`whitespace-pre-line text-[13px] leading-snug [overflow-wrap:anywhere] ${open ? "" : "line-clamp-3"}`}
        style={{ color: "var(--text-secondary)" }}
      >
        {text}
      </p>
      {(long || open) && (
        <button className={`${link} mt-1`} style={{ color: "var(--text-tertiary)" }} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t.cards.less : t.cards.more}
        </button>
      )}
    </div>
  );
}

/** What an approval says: its reason, and its raw parameters behind a quiet "Details" that opens them in place. */
export function ApprovalText({ detail }: { detail: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const { reason, parameters } = splitDetail(detail);
  return (
    <>
      {reason !== "" && <Reason text={reason} />}
      {parameters.length > 0 && (
        <div className="mt-2">
          <button className={link} style={{ color: "var(--text-tertiary)" }} aria-expanded={shown} onClick={() => setShown(!shown)}>
            {t.cards.details}
            <ChevronDown size={14} className={`transition-transform ${shown ? "rotate-180" : ""}`} />
          </button>
          {shown && (
            <ul className={`${groupClass} mt-1.5`} style={{ background: "var(--fill-primary)" }}>
              {parameters.map((p, i) => (
                <InfoRow key={i} label={p.label ?? ""}>
                  <span className="block whitespace-pre-wrap text-[15px]">{p.value}</span>
                </InfoRow>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
