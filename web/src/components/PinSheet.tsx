/**
 * The PIN's sheets: set one (with the password), change it, enter it to unlock a sensitive action, the weekly "enter it
 * so you don't forget it", and turning it off (the warning, then the password and the PIN there is). A sensitive action
 * that the server holds opens one (pin.ts asks), as does a reminder (App.tsx) or Settings › Security. The PIN goes only
 * to the server, in a request's body.
 */
import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";
import { LockKeyhole, ShieldOff } from "lucide-react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
import { PinInput } from "./PinInput";
import { useT } from "../i18n/react.ts";
import { activeLocale } from "../i18n/language.ts";
import { checkPin, remindLater, setPin, turnOffPin, unlockPin } from "../account.ts";
import { type Ask, PIN_DIGITS, type Said } from "../pin.ts";

/** set: the first PIN; change: a new one; unlock: for a sensitive action; check: the weekly reminder; off: turning it off. */
export type PinMode = "set" | "change" | "unlock" | "check" | "off";
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

/** Whether the server counted this against the PIN (a try left, or a lockout): the boxes shake when it did. */
const countedPin = (said: Exclude<Said, { ok: true }>) => said.left !== null || said.until !== null;

const fieldClass = "h-12 w-full rounded-full px-5 text-[16px] outline-none";
const fieldLook = { background: "var(--fill-secondary)", color: "var(--text-primary)" };
/** A quiet text link, as ApprovalText's: under the buttons, the smallest thing on the sheet. */
const quietLink = "hover-fade -mt-1 text-[13px]";

function PinForm({ mode, from, onClose, onTurnOff }: { mode: PinMode; from: PinFrom; onClose: (done: boolean) => void; onTurnOff: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPinText] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  /** wrong tries, per PIN field: each one shakes that field's boxes */
  const [wrongCurrent, setWrongCurrent] = useState(0);
  const [wrongPin, setWrongPin] = useState(0);
  const passwordField = useRef<HTMLInputElement>(null);
  const againField = useRef<HTMLInputElement>(null);
  const choosing = mode === "set" || mode === "change";

  const submit = async (entered: string, confirmed: string) => {
    if (busy) return;
    setProblem(null);
    if (choosing && entered !== confirmed) return setProblem(t.pin.mismatch);
    if (entered.length !== PIN_DIGITS || (mode === "change" && current.length !== PIN_DIGITS)) return setProblem(t.pin.sixDigits);
    setBusy(true);
    // a new PIN is set behind the one there is: that one first
    const unlocked = mode === "change" ? await unlockPin(current) : null;
    const said =
      unlocked && !unlocked.ok ? unlocked : choosing ? await setPin(password, entered) : mode === "unlock" ? await unlockPin(entered) : await checkPin(entered);
    setBusy(false);
    if (said.ok) return onClose(true);
    setProblem(problemOf(said, t));
    // a wrong PIN says so in the boxes as well: they shake, and what was typed goes
    if (unlocked && !unlocked.ok) {
      setCurrent("");
      if (countedPin(said)) setWrongCurrent((tries) => tries + 1);
      return;
    }
    if (!choosing) setPinText("");
    if (countedPin(said)) setWrongPin((tries) => tries + 1);
  };

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
        void submit(pin, again);
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
      {mode === "change" && (
        <PinInput
          autoFocus
          autoComplete="off"
          wrong={wrongCurrent}
          label={t.pin.currentPin}
          value={current}
          onChange={setCurrent}
          onDone={() => passwordField.current?.focus()}
        />
      )}
      {choosing && (
        <input
          ref={passwordField}
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
      <PinInput
        autoFocus={!choosing}
        autoComplete={choosing ? "off" : "one-time-code"}
        wrong={wrongPin}
        label={mode === "change" ? t.pin.newPin : t.pin.pin}
        value={pin}
        onChange={setPinText}
        onDone={(entered) => {
          // choosing a PIN goes on by itself: the field it is typed again in, and the button for the rest
          if (choosing) return againField.current?.focus();
          void submit(entered, again);
        }}
      />
      {choosing && (
        <PinInput
          ref={againField}
          autoComplete="off"
          label={t.pin.pinAgain}
          value={again}
          onChange={setAgain}
          onDone={(confirmed) => {
            // the password is the one thing the PIN cannot fill in: without it the button is the way
            if (password) void submit(pin, confirmed);
          }}
        />
      )}
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
      {mode === "set" && (
        <button className={quietLink} style={{ color: "var(--text-tertiary)" }} type="button" onClick={onTurnOff}>
          {t.pin.dontUse}
        </button>
      )}
    </form>
  );
}
/**
 * Turning the PIN off: the warning (a danger ConfirmSheet, as the action is a loosening), and with it the password, and
 * the PIN there is when there is one. What the server refuses is said here, as a wrong PIN is in the set form.
 */
function PinOffFlow({ open, needsPin, onClose }: { open: boolean; needsPin: boolean; onClose: (done: boolean) => void }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [pin, setPinText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(0);
  /** the PIN as it was typed, when the sixth digit sends it: the state may not have it yet */
  const submit = (entered = pin) => {
    if (busy || password === "" || (needsPin && entered.length !== PIN_DIGITS)) return;
    setProblem(null);
    setBusy(true);
    void turnOffPin(password, needsPin ? entered : null).then((said) => {
      setBusy(false);
      if (said.ok) return onClose(true);
      setProblem(problemOf(said, t));
      if (countedPin(said)) {
        setPinText("");
        setWrong((tries) => tries + 1);
      }
    });
  };
  return (
    <ConfirmSheet
      open={open}
      onClose={() => onClose(false)}
      icon={ShieldOff}
      title={t.pin.offTitle}
      body={t.pin.offWarning}
      action={t.pin.off}
      busy={busy}
      disabled={password === "" || (needsPin && pin.length !== PIN_DIGITS)}
      onConfirm={() => submit()}
    >
      <input
        autoFocus
        type="password"
        autoComplete="current-password"
        aria-label={t.pin.password}
        placeholder={t.pin.password}
        className={`mt-4 ${fieldClass}`}
        style={fieldLook}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {needsPin && (
        <PinInput
          autoComplete="off"
          wrong={wrong}
          label={t.pin.currentPin}
          value={pin}
          onChange={setPinText}
          onDone={(entered) => submit(entered)}
        />
      )}
      {problem && (
        <p role="alert" className="mt-2 text-[13px]" style={{ color: "var(--fill-red)" }}>
          {problem}
        </p>
      )}
    </ConfirmSheet>
  );
}

interface Asking {
  /** a new sheet's form starts empty */
  id: number;
  mode: PinMode;
  from: PinFrom;
  /** everyone waiting on this sheet: two actions held at once are both answered by one PIN */
  waiting: ((done: boolean) => void)[];
  /** turning it off: whether a PIN is set, and so has to be entered with the password */
  needsPin: boolean;
}

/**
 * Open a PIN sheet: true once it is done (the PIN set, entered or confirmed, the PIN turned off), false when the user
 * lets it be. `needsPin`: turning it off has a PIN to enter as well, which only the one opening the sheet knows.
 */
export type OpenPin = (mode: PinMode, from: PinFrom, needsPin?: boolean) => Promise<boolean>;

export const PinContext = createContext<{ ask: Ask; open: OpenPin }>({ ask: async () => false, open: async () => false });
export const usePin = () => useContext(PinContext);

/** The PIN's sheet, one at a time, and the ways to open it. */
export function usePinSheet(): { ask: Ask; open: OpenPin; sheet: ReactNode } {
  const [asking, setAsking] = useState<Asking | null>(null);
  const shown = useRef<Asking | null>(null);
  const opened = useRef(0);
  if (asking) shown.current = asking;
  const open = useCallback<OpenPin>(
    (mode, from, needsPin = false) =>
      new Promise((resolve) =>
        setAsking((now) => {
          if (now && now.mode === mode) return { ...now, waiting: [...now.waiting, resolve] };
          // another sheet was open: what waited on it is let be
          now?.waiting.forEach((w) => w(false));
          return { id: ++opened.current, mode, from, waiting: [resolve], needsPin };
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
  /** "Don't use a PIN" on the first prompt: the same sheet becomes the warning, with what waits on it kept */
  const turnOff = () =>
    setAsking((now) => (now === null ? now : { ...now, mode: "off", needsPin: now.mode === "change" }));
  const sheet = last && (
    last.mode === "off" ? (
      <PinOffFlow key={last.id} open={asking !== null} needsPin={last.needsPin} onClose={close} />
    ) : (
      <Sheet open={asking !== null} onClose={() => (last.from === "reminder" ? (void remindLater(), close(false)) : close(false))} bare>
        <PinForm key={last.id} mode={last.mode} from={last.from} onClose={close} onTurnOff={turnOff} />
      </Sheet>
    )
  );
  return { ask, open, sheet };
}
