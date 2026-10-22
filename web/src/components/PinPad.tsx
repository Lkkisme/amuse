import { useRef } from "react";
import { Delete } from "lucide-react";
import { useT } from "../i18n/react.ts";

/** A real password input for keyboard/paste, with the same touch keypad on every device. */
export function PinPad({ value, onChange, label, disabled = false, autoFocus = false, newPin = false }: {
  value: string;
  onChange(value: string): void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  newPin?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const update = (next: string) => {
    onChange(next);
    input.current?.focus({ preventScroll: true });
  };
  return (
    <div className="pin-entry">
      <label className="pin-label">
        <span>{label}</span>
        <span className="pin-dots">
          <input
            ref={input}
            autoFocus={autoFocus}
            type="password"
            inputMode="none"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete={newPin ? "new-password" : "current-password"}
            aria-label={label}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          />
          {[0, 1, 2, 3].map((position) => (
            <span key={position} className={`pin-dot${position < value.length ? " is-filled" : ""}`} aria-hidden="true">
              {position < value.length ? "●" : ""}
            </span>
          ))}
        </span>
      </label>
      <div className="pin-keypad" role="group" aria-label={t.pinUnlock.keypad}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button type="button" className="pin-key" key={digit} aria-label={String(digit)} disabled={disabled || value.length === 4} onClick={() => update(`${value}${digit}`)}>{digit}</button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className="pin-key" aria-label="0" disabled={disabled || value.length === 4} onClick={() => update(`${value}0`)}>0</button>
        <button type="button" className="pin-key pin-key-delete" aria-label={t.pinUnlock.deleteDigit} disabled={disabled || !value} onClick={() => update(value.slice(0, -1))}><Delete size={23} /></button>
      </div>
    </div>
  );
}
