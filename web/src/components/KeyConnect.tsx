/**
 * Connect an app that takes credentials of the user's own (Cloudflare's global key
 * and the account email, say): one field per thing the provider asks for, labelled
 * with what it calls it. A secret (its name says so, or Composio marks it) is typed
 * as a password; an email, an id or a subdomain is plain. What is typed here goes to
 * the server, which passes it to Composio; this form holds it only while it is typed
 * and clears it as soon as it has been sent.
 */
import { useState } from "react";
import type { GivenField, KeyField } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";
import { wordsFor } from "../shown.ts";
import { Button } from "./Button";

export function KeyConnect({
  app,
  fields,
  size = "sm",
  connect,
}: {
  app: string;
  /** what the provider asks for, in the order it asks */
  fields: KeyField[];
  size?: "sm" | "lg";
  /** sends what was typed on; rejects with words when it did not go through */
  connect: (values: GivenField[]) => Promise<void>;
}) {
  const t = useT();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = fields.every((field) => (typed[field.name] ?? "").trim() !== "");
  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    connect(fields.map((field) => ({ name: field.name, value: (typed[field.name] ?? "").trim() }))).then(
      () => {
        setTyped({});
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
        {t.connections.keyIntro(app)}
      </p>
      {fields.map((field) => (
        <label key={field.name} className="mt-2.5 block">
          <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {field.label}
          </span>
          <input
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            placeholder={field.label}
            className="mt-1 h-10 w-full rounded-[12px] px-3 text-[14px] outline-none"
            style={{ background: "var(--field)", color: "var(--text-primary)" }}
            value={typed[field.name] ?? ""}
            onChange={(e) => setTyped((was) => ({ ...was, [field.name]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
      ))}
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
        {t.connections.keyNote}
      </p>
      {error !== null && (
        <p role="alert" className="mt-1.5 text-[12px]" style={{ color: "var(--fill-red)" }}>
          {wordsFor(error, t)}
        </p>
      )}
      {/* the same Connect as an app that connects by a link: the primary button, full width, under the fields */}
      <div className="mt-5 flex justify-center">
        <Button variant="primary" size={size} className="w-full max-w-[280px]" disabled={!ready || busy} onClick={submit}>
          {busy ? t.connections.keyChecking : t.connections.connect}
        </Button>
      </div>
    </div>
  );
}
