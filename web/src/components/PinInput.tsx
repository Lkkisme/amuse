/**
 * A PIN, in six boxes: one digit each, shown as a dot. Over the row, taking its taps, sits one real `<input>`
 * — invisible, never showing its own digits — so that pasting, a phone's SMS-style code autofill, an IME and a
 * screen reader all meet an ordinary field; the boxes only draw it (pin-input.ts says what it holds). The sixth
 * digit sends the PIN (`onDone`); a wrong one shakes the boxes (`wrong`, a count) and the caller clears the value.
 */
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { PIN_DIGITS } from "../pin.ts";
import { nextBox, pastePin, pinDigits } from "../pin-input.ts";

/** as long as the shake in index.css */
const SHAKE_MS = 400;
/** a box: 44px, on the corner the app's cards and fields use */
const boxClass = "flex size-11 items-center justify-center rounded-xl text-[20px] font-semibold tabular-nums";
const boxLook = { background: "var(--fill-secondary)", color: "var(--text-primary)" };

type PinInputProps = {
  /** what a screen reader is told: the boxes are decoration */
  label: string;
  value: string;
  onChange: (pin: string) => void;
  /** the PIN, as soon as its sixth digit is in: the caller submits it, or moves on to the next field */
  onDone?: (pin: string) => void;
  /** wrong tries so far: each one shakes the boxes (nothing moves with reduced motion) */
  wrong?: number;
  autoFocus?: boolean;
  /** "off" where filling in a code from a message would be wrong: setting, confirming or changing a PIN */
  autoComplete?: "one-time-code" | "off";
};

export const PinInput = forwardRef<HTMLInputElement, PinInputProps>(function PinInput(
  { label, value, onChange, onDone, wrong = 0, autoFocus = false, autoComplete = "one-time-code" },
  ref,
) {
  const field = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [shaking, setShaking] = useState(false);
  // one shake per wrong try: the class goes off, and on again a frame later, so a try that comes close after
  // the last one still plays it afresh
  useEffect(() => {
    if (wrong === 0) return;
    setShaking(false);
    const frame = requestAnimationFrame(() => setShaking(true));
    const timer = setTimeout(() => setShaking(false), SHAKE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [wrong]);
  /** the field, and whoever asked for it (a form's next field, to move on by itself) */
  const keep = useCallback(
    (node: HTMLInputElement | null) => {
      field.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  /** what the field holds now: six digits send it */
  const commit = (next: string) => {
    onChange(next);
    if (next.length === PIN_DIGITS && next !== value) onDone?.(next);
  };
  const caret = focused ? nextBox(value) : -1;
  return (
    <div className={`relative ${shaking ? "pin-shake" : ""}`} onClick={() => field.current?.focus()}>
      <div aria-hidden className="flex gap-2">
        {Array.from({ length: PIN_DIGITS }, (_, box) => (
          <span
            key={box}
            className={`${boxClass} ${box === caret ? "outline-2 outline-offset-2 outline-[color:var(--fill-blue)]" : ""}`}
            style={boxLook}
          >
            {box < value.length && <span className="size-2 rounded-full" style={{ background: "var(--text-primary)" }} />}
          </span>
        ))}
      </div>
      <input
        ref={keep}
        autoFocus={autoFocus}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={autoComplete}
        maxLength={PIN_DIGITS}
        aria-label={label}
        // 16px so a phone does not zoom in on it; its own text is never seen, the boxes say it
        className="absolute inset-0 h-full w-full cursor-text text-[16px] opacity-0 outline-none"
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => commit(pinDigits(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          commit(pastePin(value, e.clipboardData.getData("text")));
        }}
        onKeyDown={(e) => {
          // the caret is never in the middle of the boxes: Backspace takes the last digit
          if (e.key !== "Backspace" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          commit(value.slice(0, -1));
        }}
      />
    </div>
  );
});
