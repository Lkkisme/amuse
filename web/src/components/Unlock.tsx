/**
 * The way in on a device: the master password. The very first visit sets it
 * (typed twice) with the PIN, and that device is trusted; after that the
 * password opens Muse on a trusted device, and on a new one it waits until a
 * trusted device approves it (this page then asks every few seconds, and goes
 * in once it is).
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { PinInput } from "./PinInput";
import { admitted, enter } from "../connection.ts";
import { useT } from "../i18n/react.ts";
import { PIN_DIGITS } from "../pin.ts";

/** how often a waiting device asks whether it is approved */
const POLL_MS = 3000;

export function Unlock({ ready, waiting: waitingAtStart }: { ready: boolean; waiting: boolean }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const pinAgainField = useRef<HTMLInputElement>(null);
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
  /** What the form does, with the PIN as it was typed: the sixth digit of the one typed again sends it. */
  const send = (entered: string, confirmed: string) => {
    if (!password || busy) return;
    if (!ready && password !== again) return setProblem(t.unlock.mismatch);
    if (!ready && entered.length !== PIN_DIGITS) return setProblem(t.pin.sixDigits);
    if (!ready && entered !== confirmed) return setProblem(t.pin.mismatch);
    setBusy(true);
    void enter(password, ready ? null : entered).then((why) => {
      setBusy(false);
      if (why === "waiting") {
        setProblem(null);
        return setWaiting(true);
      }
      setProblem(why);
    });
  };
  const field =
    "h-11 w-full max-w-xs rounded-full px-4 text-[15px] outline-none";
  const look = {
    background: "var(--fill-primary)",
    color: "var(--text-primary)",
    boxShadow: "var(--shadow-float)",
  };

  const heading = waiting ? t.unlock.waitingTitle : ready ? t.unlock.welcome : t.unlock.setTitle;
  const help = waiting ? t.unlock.waitingHelp : ready ? t.unlock.enterHelp : t.unlock.setHelp;

  return (
    <form
      className="flex h-full flex-col items-center justify-center gap-4 p-6"
      style={{ background: "var(--chat-background)" }}
      onSubmit={(e) => {
        e.preventDefault();
        send(pin, pinAgain);
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
              <PinInput
                autoComplete="off"
                label={t.unlock.pin}
                value={pin}
                onChange={setPin}
                onDone={() => pinAgainField.current?.focus()}
              />
              <PinInput
                ref={pinAgainField}
                autoComplete="off"
                label={t.unlock.pinAgain}
                value={pinAgain}
                onChange={setPinAgain}
                onDone={(confirmed) => {
                  // the password is the one thing the PIN cannot fill in: without it the button is the way
                  if (password && again) send(pin, confirmed);
                }}
              />
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
