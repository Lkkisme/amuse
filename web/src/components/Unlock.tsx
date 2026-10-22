/** The first visit chooses a four-digit PIN; existing passwords remain usable. */
import { useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { enter } from "../connection.ts";
import { PinPad } from "./PinPad";
import { useT } from "../i18n/react.ts";

export function Unlock({ ready }: { ready: boolean }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const value = confirming ? again : pin;
  const unlock = (credential: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    void enter(credential, !ready).then((why) => {
      inFlight.current = false;
      setBusy(false);
      setProblem(why);
      if (why && ready) {
        setPin("");
        setPassword("");
      }
    });
  };
  const change = (next: string) => {
    setProblem(null);
    if (confirming) setAgain(next);
    else {
      setPin(next);
      // Four taps unlock; the ref also guards a simultaneous Enter/click.
      if (ready && !legacy && next.length === 4) unlock(next);
    }
  };

  return (
    <main className="unlock-page">
      <form className="unlock-card" onSubmit={(event) => {
        event.preventDefault();
        if (busy || (legacy ? !password : value.length !== 4)) return;
        if (!ready && !confirming) {
          setConfirming(true);
          setProblem(null);
          return;
        }
        if (!ready && pin !== again) {
          setAgain("");
          setProblem(t.pinUnlock.mismatch);
          return;
        }
        unlock(legacy ? password : pin);
      }}>
        <span className="unlock-mark" aria-hidden="true"><LockKeyhole size={25} strokeWidth={1.7} /></span>
        <div className="unlock-heading">
          <p className="unlock-eyebrow">AMUSE</p>
          <h1>{ready ? t.unlock.welcome : confirming ? t.pinUnlock.confirmTitle : t.pinUnlock.chooseTitle}</h1>
          <p>{ready
            ? legacy ? t.pinUnlock.existingHelp : t.pinUnlock.enterHelp
            : confirming ? t.pinUnlock.confirmHelp : t.pinUnlock.chooseHelp}</p>
        </div>
        {legacy ? (
          <input autoFocus type="password" autoComplete="current-password" aria-label={t.pinUnlock.existingPassword} placeholder={t.pinUnlock.existingPassword} className="credential-password" disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value); setProblem(null); }} />
        ) : (
          <PinPad key={confirming ? "confirm" : "pin"} value={value} onChange={change} label={confirming ? t.pinUnlock.confirmLabel : ready ? t.pinUnlock.pinLabel : t.pinUnlock.newLabel} autoFocus disabled={busy} newPin={!ready} />
        )}
        {problem && <p className="credential-message is-error" role="alert">{problem}</p>}
        <button type="submit" className="credential-primary" disabled={busy || (legacy ? !password : value.length !== 4)}>
          {busy ? t.pinUnlock.waiting : ready ? t.pinUnlock.unlock : confirming ? t.pinUnlock.set : t.common.continue}
        </button>
        {ready ? (
          <button type="button" className="credential-link" disabled={busy} onClick={() => { setLegacy(!legacy); setProblem(null); setPin(""); setPassword(""); }}>
            {legacy ? t.pinUnlock.usePin : t.pinUnlock.useExisting}
          </button>
        ) : confirming ? (
          <button type="button" className="credential-link" disabled={busy} onClick={() => { setConfirming(false); setPin(""); setAgain(""); setProblem(null); }}>{t.pinUnlock.chooseDifferent}</button>
        ) : <p className="unlock-footnote">{t.pinUnlock.privateHelp}</p>}
      </form>
    </main>
  );
}
