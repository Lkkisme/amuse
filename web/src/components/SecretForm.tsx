/**
 * Adding to the Vault: first what to start from (a preset), then the entry as it can be changed in every part:
 * its name, plain fields, secret fields (at least one), a note, and where it is used. In that order, as everywhere.
 */
import { useRef, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import type { PlainInput, PlainRole, SecretInput, SecretRole, Session, UseInput } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";
import {
  type Draft,
  type Preset,
  PRESETS,
  type UseSpec,
  blank,
  describeSpec,
  problem,
  toValue,
  useOf,
} from "../secrets.ts";
import { Button } from "./Button";
import { Alert, FieldRow, Heading, NoteField, Page, TextButton, groupClass } from "./SecretFields";
import { UseForm } from "./SecretUseForm";

interface Row<Role> {
  key: number;
  name: string;
  role: Role | null;
  draft: Draft;
}

/** A use being added, for the field whose row has this key. */
interface UseRow {
  key: number;
  field: number;
  spec: UseSpec;
}

/** The rows a preset starts with, numbered in order (plain, secret, then the uses), and how many numbers that took. */
function begin(preset: Preset): { plain: Row<PlainRole>[]; secret: Row<SecretRole>[]; uses: UseRow[]; count: number } {
  let count = 0;
  const plain = preset.plain.map((f) => ({ key: ++count, name: f.name, role: f.role, draft: blank(f.kind) }));
  const secret = preset.secret.map((f) => ({ key: ++count, name: f.name, role: f.role, draft: blank(f.kind) }));
  const uses = preset.uses.flatMap((use) => {
    const field = secret.find((f) => f.name === use.field);
    return field ? [{ key: ++count, field: field.key, spec: use.spec }] : [];
  });
  return { plain, secret, uses, count };
}

export function SecretForm({ session, onBack, onAdded }: { session: Session; onBack: () => void; onAdded: () => void }) {
  const t = useT();
  const [preset, setPreset] = useState<Preset | null>(null);
  if (!preset)
    return (
      <Page onBack={onBack}>
        <Heading title={t.secrets.startFrom} />
        <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button
                className="flex w-full items-center gap-3 py-3 text-left"
                onClick={() => setPreset(p)}
              >
                <KeyRound size={18} style={{ color: "var(--icon-secondary)" }} />
                <span className="text-[16px]" style={{ color: "var(--text-primary)" }}>
                  {t.secrets.presets[p.id]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Page>
    );
  return <Filling preset={preset} session={session} onBack={onBack} onAdded={onAdded} />;
}

function Filling({
  preset,
  session,
  onBack,
  onAdded,
}: {
  preset: Preset;
  session: Session;
  onBack: () => void;
  onAdded: () => void;
}) {
  const t = useT();
  // the form's rows are numbered from the start, so a use can name the field it is for while the fields are renamed
  const [start] = useState(() => begin(preset));
  const keys = useRef(start.count);
  const next = () => ++keys.current;
  const [name, setName] = useState("");
  const [plain, setPlain] = useState(start.plain);
  const [secret, setSecret] = useState(start.secret);
  const [note, setNote] = useState("");
  const [uses, setUses] = useState(start.uses);
  const [addingUse, setAddingUse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stuck = problem({
    name,
    plain: plain.map((f) => ({ name: f.name, draft: f.draft })),
    secret: secret.map((f) => ({ name: f.name, draft: f.draft })),
  });
  const all = [...plain, ...secret];
  const nameOf = (key: number) => all.find((f) => f.key === key)?.name.trim() ?? "";

  const edit = <Role,>(set: (change: (rows: Row<Role>[]) => Row<Role>[]) => void, key: number, change: Partial<Row<Role>>) =>
    set((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const drop = (key: number) => {
    setPlain((rows) => rows.filter((row) => row.key !== key));
    setSecret((rows) => rows.filter((row) => row.key !== key));
    setUses((rows) => rows.filter((use) => use.field !== key));
  };

  const save = () => {
    const plainInputs: PlainInput[] = plain.flatMap((f) => {
      const value = toValue(f.draft, f.name);
      return value ? [{ name: f.name.trim(), role: f.role, value }] : [];
    });
    const secretInputs: SecretInput[] = secret.flatMap((f) => {
      const value = toValue(f.draft, f.name);
      return value ? [{ name: f.name.trim(), role: f.role, value }] : [];
    });
    const useInputs: UseInput[] = uses.map((use) => useOf(nameOf(use.field), use.spec));
    setBusy(true);
    setError(null);
    session
      .call("secrets.add", { name: name.trim(), note, plain: plainInputs, secret: secretInputs, uses: useInputs })
      .then(onAdded, (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  return (
    <Page onBack={onBack}>
      <Heading title={t.secrets.name} />
      <div className="rounded-[18px] px-4 py-2" style={{ background: "var(--fill-secondary)" }}>
        <input
          autoFocus
          aria-label={t.secrets.name}
          placeholder={t.secrets.namePlaceholder}
          maxLength={100}
          className="w-full bg-transparent py-1.5 text-[16px] outline-none"
          style={{ color: "var(--text-primary)" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <Heading title={t.secrets.details} help={t.secrets.detailsHelp} />
      <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
        {plain.map((f) => (
          <FieldRow
            key={f.key}
            name={f.name}
            onName={(n) => edit(setPlain, f.key, { name: n })}
            draft={f.draft}
            onDraft={(draft) => edit(setPlain, f.key, { draft })}
            secret={false}
            kindEditable
            onRemove={() => drop(f.key)}
          />
        ))}
        <li>
          <div className="py-1">
            <TextButton onClick={() => setPlain((rows) => [...rows, { key: next(), name: "", role: null, draft: blank("text") }])}>
              <Plus size={14} className="mr-1 inline" />
              {t.secrets.addDetail}
            </TextButton>
          </div>
        </li>
      </ul>

      <Heading title={t.secrets.secretHeading} help={t.secrets.secretHelp} />
      <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
        {secret.map((f) => (
          <FieldRow
            key={f.key}
            name={f.name}
            onName={(n) => edit(setSecret, f.key, { name: n })}
            draft={f.draft}
            onDraft={(draft) => edit(setSecret, f.key, { draft })}
            secret
            kindEditable
            onRemove={secret.length > 1 ? () => drop(f.key) : null}
          />
        ))}
        <li>
          <div className="py-1">
            <TextButton onClick={() => setSecret((rows) => [...rows, { key: next(), name: "", role: null, draft: blank("text") }])}>
              <Plus size={14} className="mr-1 inline" />
              {t.secrets.addSecret}
            </TextButton>
          </div>
        </li>
      </ul>

      <Heading title={t.secrets.noteHeading} help={t.secrets.noteHelp} />
      <NoteField value={note} onChange={setNote} />

      <Heading title={t.secrets.usesHeading} />
      <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
        {uses.length === 0 && (
          <li className="py-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
            {t.secrets.noUses}
          </li>
        )}
        {uses.map((use) => (
          <li key={use.key} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]" style={{ color: "var(--text-primary)" }}>
                {describeSpec(use.spec, t)}
              </span>
              <span className="block truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {t.secrets.useFor(nameOf(use.field))}
              </span>
            </span>
            <TextButton tone="danger" onClick={() => setUses((rows) => rows.filter((r) => r.key !== use.key))}>
              {t.common.remove}
            </TextButton>
          </li>
        ))}
      </ul>
      {addingUse ? (
        <UseForm
          fields={all.map((f) => ({ id: String(f.key), name: f.name.trim() || t.secrets.fieldName, kind: f.draft.kind }))}
          onCancel={() => setAddingUse(false)}
          onAdd={(field, spec) => {
            setUses((rows) => [...rows, { key: next(), field: Number(field), spec }]);
            setAddingUse(false);
          }}
        />
      ) : (
        <div className="mt-1">
          <TextButton onClick={() => setAddingUse(true)}>{t.secrets.addUse}</TextButton>
        </div>
      )}

      <Alert message={error} />
      {stuck && (
        <p className="mt-4 px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {t.secrets.problem[stuck]}
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-4" disabled={stuck !== null || busy} onClick={save}>
        {t.common.add}
      </Button>
      <Button variant="plain" size="lg" className="mt-2" onClick={onBack}>
        {t.common.cancel}
      </Button>
    </Page>
  );
}
