/**
 * Adding to the Vault: first what kind of thing it is, then the few boxes that kind has. Where it is used is not
 * asked here: a card sets that up when Amuse asks for a key, and Advanced on the entry's page does it by hand.
 */
import { useState } from "react";
import { Globe, KeyRound, Shapes } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PlainInput, SecretInput, Session } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";
import { type Kind, KINDS, toValue, typedSecret } from "../secrets.ts";
import { Button } from "./Button";
import { Alert, Box, BoxRow, NoteRow, Page, groupClass } from "./SecretFields";

const ICONS: Record<Kind, LucideIcon> = { key: KeyRound, login: Globe, custom: Shapes };

export function SecretForm({ session, onBack, onAdded }: { session: Session; onBack: () => void; onAdded: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<Kind | null>(null);
  if (!kind)
    return (
      <Page onBack={onBack}>
        <p className="mb-2 mt-4 px-1 text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {t.secrets.kindTitle}
        </p>
        <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
          {KINDS.map((k) => {
            const Icon = ICONS[k];
            return (
              <li key={k}>
                <button className="flex w-full items-center gap-3 py-3 text-left" onClick={() => setKind(k)}>
                  <Icon size={18} style={{ color: "var(--icon-secondary)" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px]" style={{ color: "var(--text-primary)" }}>
                      {t.secrets.kinds[k]}
                    </span>
                    <span className="block text-[13px]" style={{ color: "var(--text-secondary)" }}>
                      {t.secrets.kindHelp[k]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Page>
    );
  return <Filling kind={kind} session={session} onBack={onBack} onAdded={onAdded} />;
}

function Filling({ kind, session, onBack, onAdded }: { kind: Kind; session: Session; onBack: () => void; onAdded: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // what each kind keeps, under the names Amuse reads
  const secretName = { key: "key", login: "password", custom: "secret" }[kind];
  const secretValue = typedSecret(secret, secretName);
  const unnamed = name.trim() === "";
  const unfilled = secretValue === null || (kind === "login" && toValue({ kind: "text", text: username }, "username") === null);

  const save = () => {
    if (!secretValue) return;
    const plain: PlainInput[] = kind === "login" ? [{ name: "username", role: "username", value: { kind: "text", text: username } }] : [];
    const secrets: SecretInput[] = [{ name: secretName, role: kind === "login" ? "password" : null, value: secretValue }];
    setBusy(true);
    setError(null);
    session.call("secrets.add", { name: name.trim(), note, plain, secret: secrets, uses: [] }).then(onAdded, (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  return (
    <Page onBack={onBack}>
      <p className="mb-2 mt-4 px-1 text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
        {t.secrets.kinds[kind]}
      </p>
      <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
        <BoxRow label={kind === "login" ? t.secrets.site : t.secrets.name}>
          <Box autoFocus value={name} onChange={setName} placeholder={kind === "login" ? t.secrets.sitePlaceholder : t.secrets.namePlaceholder} max={100} />
        </BoxRow>
        {kind === "login" && (
          <BoxRow label={t.secrets.username}>
            <Box value={username} onChange={setUsername} />
          </BoxRow>
        )}
        <BoxRow label={{ key: t.secrets.apiKey, login: t.secrets.password, custom: t.secrets.secret }[kind]}>
          <Box hidden lines={kind === "custom"} value={secret} onChange={setSecret} placeholder={t.secrets.valuePlaceholder} />
        </BoxRow>
        {kind === "custom" && <NoteRow value={note} onChange={setNote} />}
      </ul>
      <Alert message={error} />
      {(unnamed || unfilled) && (name !== "" || secret !== "") && (
        <p className="mt-4 px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {unnamed ? t.secrets.problem.name : t.secrets.problem.value}
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-4" disabled={unnamed || unfilled || busy} onClick={save}>
        {t.common.add}
      </Button>
      <Button variant="plain" size="lg" className="mt-2" onClick={onBack}>
        {t.common.cancel}
      </Button>
    </Page>
  );
}
