/**
 * The PIN's sheets: set one (with the password), change it, enter it to unlock a sensitive action, and the weekly
 * "enter it so you don't forget it". A sensitive action that the server holds opens one (pin.ts asks), as does a
 * reminder (App.tsx) or Settings › Security. The PIN goes only to the server, in a request's body.
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { useT } from "../i18n/react.ts";
import { activeLocale } from "../i18n/language.ts";
import { checkPin, remindLater, setPin, unlockPin } from "../account.ts";
import { type Ask, PIN_DIGITS, type Said, pinDigits } from "../pin.ts";

/** set: the first PIN; change: a new one; unlock: for a sensitive action; check: the weekly reminder. */
export type PinMode = "set" | "change" | "unlock" | "check";
/** asked by an action (Cancel lets it be), by a reminder (Later puts it off a day), or from Settings */
export type PinFrom = "action" | "reminder" | "settings";

/** A time the PIN is locked until, as said in a sentence: the time, with the day when it is not today. */
export function untilWords(until: string): string {
  const date = new Date(until);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(activeLocale(), { hour: "numeric", minute: "2-digit", ...(today ? {} : { month: "short", day: "numeric" }) });
}

/** What a failed try says, in the user's words. */
function problemOf(said: Exclude<Said, { ok: true }>, t: ReturnType<typeof useT>): string {
  if (said.until) return t.pin.lockedUntil(untilWords(said.until));
  if (said.left !== null) return t.pin.wrong(said.left);
  return said.reason;
}

const fieldClass = "h-12 w-full rounded-full px-5 text-[16px] outline-none";
const fieldLook = { background: "var(--fill-secondary)", color: "var(--text-primary)" };

/** Six digits, shown as dots; a phone shows its number pad. */
function PinField({ label, value, onChange, autoFocus = false }: { label: string; value: string; onChange: (pin: string) => void; autoFocus?: boolean }) {
  return (
    <input
      autoFocus={autoFocus}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      maxLength={PIN_DIGITS}
      aria-label={label}
      placeholder={label}
      // the dots spaced out, the placeholder as it is
      className={`${fieldClass} text-center ${value ? "tracking-[0.4em]" : ""}`}
      style={fieldLook}
      value={value}
      onChange={(e) => onChange(pinDigits(e.target.value))}
    />
  );
}

function PinForm({ mode, from, onClose }: { mode: PinMode; from: PinFrom; onClose: (done: boolean) => void }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPinText] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const choosing = mode === "set" || mode === "change";

  const submit = async () => {
    if (busy) return;
    setProblem(null);
    if (choosing && pin !== again) return setProblem(t.pin.mismatch);
    if (pin.length !== PIN_DIGITS || (mode === "change" && current.length !== PIN_DIGITS)) return setProblem(t.pin.sixDigits);
    setBusy(true);
    // a new PIN is set behind the one there is: that one first
    const unlocked = mode === "change" ? await unlockPin(current) : null;
    const said =
      unlocked && !unlocked.ok ? unlocked : choosing ? await setPin(password, pin) : mode === "unlock" ? await unlockPin(pin) : await checkPin(pin);
    setBusy(false);
    if (said.ok) return onClose(true);
    setProblem(problemOf(said, t));
    if (!choosing) setPinText("");
  };
  // entering the PIN goes as soon as it has its six digits
  useEffect(() => {
    if (!choosing && pin.length === PIN_DIGITS) void submit();
  }, [pin]);

  const later = () => {
    void remindLater();
    onClose(false);
  };
  const title = mode === "set" ? t.pin.setTitle : mode === "change" ? t.pin.changeTitle : t.pin.enterTitle;
  const line = choosing ? t.pin.setLine : mode === "check" ? t.pin.checkLine : null;
  return (
    <form
      className="flex flex-col items-center gap-3 px-6 pb-6 pt-5 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <span className="flex size-14 items-center justify-center rounded-[16px]" style={{ background: "#ffffff", color: "#111112" }}>
        <LockKeyhole size={26} />
      </span>
      <p className="mt-1 text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      {line && (
        <p className="-mt-2 text-[14px]" style={{ color: "var(--text-secondary)" }}>
          {line}
        </p>
      )}
      {mode === "change" && <PinField autoFocus label={t.pin.currentPin} value={current} onChange={setCurrent} />}
      {choosing && (
        <input
          autoFocus={mode === "set"}
          type="password"
          autoComplete="current-password"
          aria-label={t.pin.password}
          placeholder={t.pin.password}
          className={fieldClass}
          style={fieldLook}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      <PinField autoFocus={!choosing} label={mode === "change" ? t.pin.newPin : t.pin.pin} value={pin} onChange={setPinText} />
      {choosing && <PinField label={t.pin.pinAgain} value={again} onChange={setAgain} />}
      {problem && (
        <p role="alert" className="text-[13px]" style={{ color: "var(--fill-red)" }}>
          {problem}
        </p>
      )}
      {forgot && (
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {t.pin.forgotHelp}
        </p>
      )}
      {choosing && (
        <Button variant="primary" size="lg" className="mt-3" type="submit" disabled={busy || !password || pin.length !== PIN_DIGITS || again.length !== PIN_DIGITS}>
          {mode === "set" ? t.pin.set : t.pin.change}
        </Button>
      )}
      {mode === "check" && !forgot && (
        <Button variant="plain" size="lg" type="button" onClick={() => setForgot(true)}>
          {t.pin.forgot}
        </Button>
      )}
      <Button variant="plain" size="lg" className={choosing ? "" : "mt-1"} type="button" onClick={() => (from === "reminder" ? later() : onClose(false))}>
        {from === "reminder" ? t.pin.later : t.common.cancel}
      </Button>
    </form>
  );
}

interface Asking {
  /** a new sheet's form starts empty */
  id: number;
  mode: PinMode;
  from: PinFrom;
  /** everyone waiting on this sheet: two actions held at once are both answered by one PIN */
  waiting: ((done: boolean) => void)[];
}

/** Open a PIN sheet: true once it is done (the PIN set, entered or confirmed), false when the user lets it be. */
export type OpenPin = (mode: PinMode, from: PinFrom) => Promise<boolean>;

export const PinContext = createContext<{ ask: Ask; open: OpenPin }>({ ask: async () => false, open: async () => false });
export const usePin = () => useContext(PinContext);

/** The PIN's sheet, one at a time, and the ways to open it. */
export function usePinSheet(): { ask: Ask; open: OpenPin; sheet: ReactNode } {
  const [asking, setAsking] = useState<Asking | null>(null);
  const shown = useRef<Asking | null>(null);
  const opened = useRef(0);
  if (asking) shown.current = asking;
  const open = useCallback<OpenPin>(
    (mode, from) =>
      new Promise((resolve) =>
        setAsking((now) => {
          if (now && now.mode === mode) return { ...now, waiting: [...now.waiting, resolve] };
          // another sheet was open: what waited on it is let be
          now?.waiting.forEach((w) => w(false));
          return { id: ++opened.current, mode, from, waiting: [resolve] };
        }),
      ),
    [],
  );
  const ask = useCallback<Ask>((need) => open(need === "unset" ? "set" : "unlock", "action"), [open]);
  const close = (done: boolean) =>
    setAsking((now) => {
      now?.waiting.forEach((w) => w(done));
      return null;
    });
  // the form is kept while the sheet slides away, and a new one starts empty
  const last = shown.current;
  const sheet = last && (
    <Sheet open={asking !== null} onClose={() => (last.from === "reminder" ? (void remindLater(), close(false)) : close(false))} bare>
      <PinForm key={last.id} mode={last.mode} from={last.from} onClose={close} />
    </Sheet>
  );
  return { ask, open, sheet };
}
