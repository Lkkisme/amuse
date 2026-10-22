import { useState } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";
import { changePassword, lock } from "../connection.ts";
import { PinPad } from "./PinPad";

/** Change an existing PIN or legacy password, keeping confirmation on this device. */
export function PinSecurity() {
  const [changing, setChanging] = useState(false);
  const [step, setStep] = useState<"current" | "new" | "confirm">("current");
  const [legacy, setLegacy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const value = step === "current" ? current : step === "new" ? next : again;
  const reset = () => { setCurrent(""); setNext(""); setAgain(""); setStep("current"); setLegacy(false); };
  const change = (value: string) => {
    setSaid(null);
    if (step === "current") setCurrent(value);
    else if (step === "new") setNext(value);
    else setAgain(value);
  };
  const complete = step === "current" && legacy ? !!current : value.length === 4;
  const label = step === "current" ? "Current four-digit PIN" : step === "new" ? "New four-digit PIN" : "Confirm new PIN";

  return (
    <>
      <p className="mb-2 mt-6 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Security</p>
      <div className="pin-security">
        {changing ? (
          <form className="pin-security-form" onSubmit={(event) => {
            event.preventDefault();
            if (!complete || busy) return;
            if (step === "current") { setStep("new"); setSaid(null); return; }
            if (step === "new") { setStep("confirm"); setSaid(null); return; }
            if (next !== again) { setAgain(""); setSaid({ ok: false, text: "PINs don’t match. Try those four digits again." }); return; }
            setBusy(true);
            setSaid(null);
            void changePassword(current, next).then((why) => {
              setBusy(false);
              reset();
              if (why) setSaid({ ok: false, text: why });
              else { setChanging(false); setSaid({ ok: true, text: "PIN changed. Other devices must unlock again." }); }
            });
          }}>
            <div className="pin-security-heading">
              <span className="unlock-eyebrow">STEP {step === "current" ? "1" : step === "new" ? "2" : "3"} OF 3</span>
              <h3>{step === "current" ? "Verify it’s you" : step === "new" ? "Choose your new PIN" : "One more time"}</h3>
              <p>{step === "current" ? "Enter your current PIN or existing password." : step === "new" ? "Use four digits you can remember." : "Confirm the four digits to save your PIN."}</p>
            </div>
            {step === "current" && legacy ? (
              <input autoFocus type="password" autoComplete="current-password" aria-label="Current password" placeholder="Current password" className="credential-password" value={current} disabled={busy} onChange={(event) => change(event.target.value)} />
            ) : <PinPad key={step} value={value} onChange={change} label={label} disabled={busy} autoFocus newPin={step !== "current"} />}
            {step === "current" && <button type="button" className="credential-link" disabled={busy} onClick={() => { setLegacy(!legacy); setCurrent(""); setSaid(null); }}>{legacy ? "Use current PIN" : "Use existing password"}</button>}
            {said && !said.ok && <p className="credential-message is-error" role="alert">{said.text}</p>}
            <button type="submit" className="credential-primary" disabled={!complete || busy}>{busy ? "Saving…" : step === "confirm" ? "Save new PIN" : "Continue"}</button>
            <div className="pin-security-actions">
              {step !== "current" && <button type="button" className="credential-link" disabled={busy} onClick={() => { setSaid(null); setAgain(""); setStep(step === "confirm" ? "new" : "current"); }}><ChevronLeft size={15} />Back</button>}
              <button type="button" className="credential-link" disabled={busy} onClick={() => { setChanging(false); setSaid(null); reset(); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="pin-security-row" onClick={() => { reset(); setSaid(null); setChanging(true); }}><span><LockKeyhole size={17} />Change four-digit PIN</span><ChevronRight size={17} /></button>
        )}
        <button className="pin-security-row is-lock" disabled={busy} onClick={() => void lock()}>Lock this device</button>
      </div>
      {said && !changing && <p role={said.ok ? "status" : "alert"} className={`credential-message mt-2${said.ok ? "" : " is-error"}`}>{said.text}</p>}
    </>
  );
}
