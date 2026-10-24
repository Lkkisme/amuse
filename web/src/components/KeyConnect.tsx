/**
 * Connect an app that takes the user's own key (an API token): one field,
 * labelled with what the provider calls it. The key is typed here and goes to
 * the server, which passes it to Composio; this form holds it only while it
 * is typed and clears it as soon as it has been sent.
 */
import { useState } from "react";
import { useT } from "../i18n/react.ts";
import { wordsFor } from "../shown.ts";
import { Button } from "./Button";

export function KeyConnect({
  app,
  label,
  size = "sm",
  connect,
}: {
  app: string;
  label: string;
  size?: "sm" | "lg";
  /** sends the key on; rejects with words when it did not go through */
  connect: (key: string) => Promise<void>;
}) {
  const t = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    connect(key.trim()).then(
      () => {
        setKey("");
        setBusy(false);
      },
      (e: unknown) => {
        setError(e);
        setBusy(false);
      },
    );
  };
  return (
    <div className="text-left">
      <p className="text-[14px]" style={{ color: "var(--text-primary)" }}>
        {t.connections.keyIntro(app, label)}
      </p>
      <input
        type="password"
        autoComplete="off"
        aria-label={label}
        placeholder={label}
        className="mt-2.5 h-10 w-full rounded-[12px] px-3 text-[14px] outline-none"
        style={{ background: "var(--field)", color: "var(--text-primary)" }}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
        {t.connections.keyNote}
      </p>
      {error !== null && (
        <p role="alert" className="mt-1.5 text-[12px]" style={{ color: "var(--fill-red)" }}>
          {wordsFor(error, t)}
        </p>
      )}
      {/* the same Connect as an app that connects by a link: the primary button, full width, under the field */}
      <div className="mt-5 flex justify-center">
        <Button variant="primary" size={size} className="w-full max-w-[280px]" disabled={!key.trim() || busy} onClick={submit}>
          {busy ? t.connections.keyChecking : t.connections.connect}
        </Button>
      </div>
    </div>
  );
}
