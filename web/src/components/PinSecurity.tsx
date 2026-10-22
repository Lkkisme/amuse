import { useState } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";
import { changePassword, lock } from "../connection.ts";
import { PinPad } from "./PinPad";
import { useT } from "../i18n/react.ts";

/** Change an existing PIN or legacy password, keeping confirmation on this device. */
export function PinSecurity() {
  const t = useT();
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
  const label = step === "current" ? t.pinSecurity.currentPin : step === "new" ? t.pinUnlock.newLabel : t.pinUnlock.confirmLabel;

  return (
    <>
      <p className="mb-2 mt-6 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>{t.pinSecurity.title}</p>
      <div className="pin-security">
        {changing ? (
          <form className="pin-security-form" onSubmit={(event) => {
            event.preventDefault();
            if (!complete || busy) return;
            if (step === "current") { setStep("new"); setSaid(null); return; }
            if (step === "new") { setStep("confirm"); setSaid(null); return; }
            if (next !== again) { setAgain(""); setSaid({ ok: false, text: t.pinUnlock.mismatch }); return; }
            setBusy(true);
            setSaid(null);
            void changePassword(current, next).then((why) => {
              setBusy(false);
              reset();
              if (why) setSaid({ ok: false, text: why });
              else { setChanging(false); setSaid({ ok: true, text: t.pinSecurity.changed }); }
            });
          }}>
            <div className="pin-security-heading">
              <span className="unlock-eyebrow">{t.pinSecurity.step} {step === "current" ? "1" : step === "new" ? "2" : "3"} / 3</span>
              <h3>{step === "current" ? t.pinSecurity.verify : step === "new" ? t.pinSecurity.choose : t.pinSecurity.again}</h3>
              <p>{step === "current" ? t.pinSecurity.currentHelp : step === "new" ? t.pinSecurity.newHelp : t.pinSecurity.confirmHelp}</p>
            </div>
            {step === "current" && legacy ? (
              <input autoFocus type="password" autoComplete="current-password" aria-label={t.settings.general.currentPassword} placeholder={t.settings.general.currentPassword} className="credential-password" value={current} disabled={busy} onChange={(event) => change(event.target.value)} />
            ) : <PinPad key={step} value={value} onChange={change} label={label} disabled={busy} autoFocus newPin={step !== "current"} />}
            {step === "current" && <button type="button" className="credential-link" disabled={busy} onClick={() => { setLegacy(!legacy); setCurrent(""); setSaid(null); }}>{legacy ? t.pinSecurity.useCurrent : t.pinUnlock.useExisting}</button>}
            {said && !said.ok && <p className="credential-message is-error" role="alert">{said.text}</p>}
            <button type="submit" className="credential-primary" disabled={!complete || busy}>{busy ? t.pinSecurity.saving : step === "confirm" ? t.pinSecurity.save : t.common.continue}</button>
            <div className="pin-security-actions">
              {step !== "current" && <button type="button" className="credential-link" disabled={busy} onClick={() => { setSaid(null); setAgain(""); setStep(step === "confirm" ? "new" : "current"); }}><ChevronLeft size={15} />{t.common.back}</button>}
              <button type="button" className="credential-link" disabled={busy} onClick={() => { setChanging(false); setSaid(null); reset(); }}>{t.common.cancel}</button>
            </div>
          </form>
        ) : (
          <button className="pin-security-row" onClick={() => { reset(); setSaid(null); setChanging(true); }}><span><LockKeyhole size={17} />{t.pinSecurity.change}</span><ChevronRight size={17} /></button>
        )}
        <button className="pin-security-row is-lock" disabled={busy} onClick={() => void lock()}>{t.settings.general.lockDevice}</button>
      </div>
      {said && !changing && <p role={said.ok ? "status" : "alert"} className={`credential-message mt-2${said.ok ? "" : " is-error"}`}>{said.text}</p>}
    </>
  );
}
