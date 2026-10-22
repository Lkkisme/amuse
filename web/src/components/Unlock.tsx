/** The first visit chooses a four-digit PIN; existing passwords remain usable. */
import { useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { enter } from "../connection.ts";
import { PinPad } from "./PinPad";

export function Unlock({ ready }: { ready: boolean }) {
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
          setProblem("PINs don’t match. Enter the same four digits again.");
          return;
        }
        unlock(legacy ? password : pin);
      }}>
        <span className="unlock-mark" aria-hidden="true"><LockKeyhole size={25} strokeWidth={1.7} /></span>
        <div className="unlock-heading">
          <p className="unlock-eyebrow">AMUSE</p>
          <h1>{ready ? "Welcome back" : confirming ? "Confirm your PIN" : "Choose your PIN"}</h1>
          <p>{ready
            ? legacy ? "Enter your existing password to unlock this device." : "Tap your four-digit PIN to unlock this device."
            : confirming ? "Enter those four digits once more." : "Four digits to open Amuse on your devices."}</p>
        </div>
        {legacy ? (
          <input autoFocus type="password" autoComplete="current-password" aria-label="Existing password" placeholder="Existing password" className="credential-password" disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value); setProblem(null); }} />
        ) : (
          <PinPad key={confirming ? "confirm" : "pin"} value={value} onChange={change} label={confirming ? "Confirm four-digit PIN" : ready ? "Four-digit PIN" : "New four-digit PIN"} autoFocus disabled={busy} newPin={!ready} />
        )}
        {problem && <p className="credential-message is-error" role="alert">{problem}</p>}
        <button type="submit" className="credential-primary" disabled={busy || (legacy ? !password : value.length !== 4)}>
          {busy ? "Please wait…" : ready ? "Unlock Amuse" : confirming ? "Set PIN" : "Continue"}
        </button>
        {ready ? (
          <button type="button" className="credential-link" disabled={busy} onClick={() => { setLegacy(!legacy); setProblem(null); setPin(""); setPassword(""); }}>
            {legacy ? "Use four-digit PIN" : "Use existing password"}
          </button>
        ) : confirming ? (
          <button type="button" className="credential-link" disabled={busy} onClick={() => { setConfirming(false); setPin(""); setAgain(""); setProblem(null); }}>Choose a different PIN</button>
        ) : <p className="unlock-footnote">Your PIN stays private. Your chats stay here.</p>}
      </form>
    </main>
  );
}
