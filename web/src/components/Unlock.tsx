/**
 * The way in on a device: the master password. The very first visit sets it
 * (typed twice) with the PIN, and that device is trusted; after that the
 * password opens Muse on a trusted device, and on a new one it waits until a
 * trusted device approves it (this page then asks every few seconds, and goes
 * in once it is).
 */
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { admitted, enter } from "../connection.ts";
import { useT } from "../i18n/react.ts";
import { PIN_DIGITS, pinDigits } from "../pin.ts";

/** how often a waiting device asks whether it is approved */
const POLL_MS = 3000;

export function Unlock({ ready, waiting: waitingAtStart }: { ready: boolean; waiting: boolean }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(waitingAtStart);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void admitted().then((inNow) => {
        if (inNow) location.replace(location.pathname + location.search);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  const field =
    "h-11 w-full max-w-xs rounded-full px-4 text-[15px] outline-none";
  const look = {
    background: "var(--fill-primary)",
    color: "var(--text-primary)",
    boxShadow: "var(--shadow-float)",
  };
  const pinField = (value: string, onChange: (pin: string) => void, label: string) => (
    <input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      maxLength={PIN_DIGITS}
      aria-label={label}
      placeholder={label}
      className={`${field} text-center ${value ? "tracking-[0.3em]" : ""}`}
      style={look}
      value={value}
      onChange={(e) => onChange(pinDigits(e.target.value))}
    />
  );
  const heading = waiting ? t.unlock.waitingTitle : ready ? t.unlock.welcome : t.unlock.setTitle;
  const help = waiting ? t.unlock.waitingHelp : ready ? t.unlock.enterHelp : t.unlock.setHelp;

  return (
    <form
      className="flex h-full flex-col items-center justify-center gap-4 p-6"
      style={{ background: "var(--chat-background)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || busy) return;
        if (!ready && password !== again)
          return setProblem(t.unlock.mismatch);
        if (!ready && pin.length !== PIN_DIGITS) return setProblem(t.pin.sixDigits);
        if (!ready && pin !== pinAgain) return setProblem(t.pin.mismatch);
        setBusy(true);
        void enter(password, ready ? null : pin).then((why) => {
          setBusy(false);
          if (why === "waiting") {
            setProblem(null);
            return setWaiting(true);
          }
          setProblem(why);
        });
      }}
    >
      <span
        className="flex size-14 items-center justify-center rounded-full text-[22px] font-semibold"
        style={{
          background: "var(--avatar-fill)",
          color: "var(--avatar-text)",
          boxShadow: "var(--shadow-float)",
        }}
      >
        A
      </span>
      <div className="max-w-xs text-center">
        <p
          className="text-[17px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {heading}
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {help}
        </p>
      </div>
      {!waiting && (
        <>
          <input
            autoFocus
            type="password"
            autoComplete={ready ? "current-password" : "new-password"}
            aria-label={t.unlock.password}
            placeholder={t.unlock.password}
            className={field}
            style={look}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {!ready && (
            <input
              type="password"
              autoComplete="new-password"
              aria-label={t.unlock.passwordAgain}
              placeholder={t.unlock.passwordAgain}
              className={field}
              style={look}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
          {!ready && (
            <>
              <p
                className="mt-2 max-w-xs text-center text-[14px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {t.pin.setLine}
              </p>
              {pinField(pin, setPin, t.unlock.pin)}
              {pinField(pinAgain, setPinAgain, t.unlock.pinAgain)}
            </>
          )}
        </>
      )}
      {problem && (
        <p
          className="max-w-xs text-center text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {problem}
        </p>
      )}
      {waiting ? (
        <Button
          variant="plain"
          size="lg"
          className="max-w-xs"
          type="button"
          onClick={() => setWaiting(false)}
        >
          {t.common.back}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="max-w-xs"
          type="submit"
          disabled={busy}
        >
          {ready ? t.common.continue : t.unlock.setButton}
        </Button>
      )}
    </form>
  );
}
