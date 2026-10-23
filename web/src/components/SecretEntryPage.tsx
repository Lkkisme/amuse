/**
 * One entry of the Vault. Its name, plain fields and note are edited and saved together; a secret field is
 * never shown (its end, or its file's name and size), only replaced, added or taken away, each as it is done; and its
 * uses are listed, added (in the sandbox) and removed.
 */
import { useRef, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import type { PlainInput, PlainRole, SecretEntry, SecretField, Session } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";
import type { Messages } from "../i18n/en.ts";
import { moment } from "../schedules.ts";
import {
  type Draft,
  type ProviderNames,
  blank,
  describeUse,
  formatSize,
  hintText,
  fromValue,
  problem,
  toValue,
  useOf,
  usesSummary,
} from "../secrets.ts";
import { Button } from "./Button";
import { Alert, FieldRow, Heading, KindToggle, NoteField, Page, RemoveSheet, TextButton, ValueEditor, groupClass } from "./SecretFields";
import { UseForm } from "./SecretUseForm";

interface PlainRow {
  key: number;
  name: string;
  role: PlainRole | null;
  draft: Draft;
  /** added here, not saved yet: it may be text or a file */
  fresh: boolean;
}

/** What a secret field is, without its value: the end of a line, or a file's name and size. */
function held(field: SecretField, t: Messages): string {
  if (field.kind === "file") return `${field.filename ?? ""} · ${formatSize(field.size)}`;
  return field.hint ? hintText(field.hint) : t.secrets.isSet;
}

function lastUsed(field: SecretField, t: Messages): string {
  if (!field.last) return t.secrets.neverUsed;
  const when = moment(field.last.at);
  return field.last.how === "sandbox" ? t.secrets.lastUsedSandbox(when, field.last.what) : t.secrets.lastUsedServer(when, field.last.what);
}

/** An entry the system keeps (a provider's sign-in): listed as it stands, and taken away, which signs out; not edited. */
function ManagedPage({
  session,
  entry,
  names,
  onBack,
  onChanged,
}: {
  session: Session;
  entry: SecretEntry;
  names: ProviderNames;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = () => {
    setBusy(true);
    setError(null);
    session
      .call("secrets.remove", { id: entry.id })
      .then(() => onChanged())
      .then(
        () => setRemoving(false),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Page onBack={onBack}>
      <div className="mt-2 flex flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-[14px]" style={{ background: "#ffffff", color: "#111112" }}>
          <KeyRound size={22} />
        </span>
        <p className="mt-2 text-[18px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {entry.name}
        </p>
        <p className="mt-0.5 text-[13px] [overflow-wrap:anywhere]" style={{ color: "var(--text-secondary)" }}>
          {usesSummary(entry, names, t)}
        </p>
      </div>
      <p className="mt-4 px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
        <span className="mr-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: "var(--fill-secondary)", color: "var(--text-primary)" }}>
          {t.secrets.managed}
        </span>
        {t.secrets.managedNote}
      </p>
      <Alert message={error} />
      <ul className={`${groupClass} mt-4`} style={{ background: "var(--fill-secondary)" }}>
        {entry.secret.map((f) => (
          <li key={f.name} className="py-3">
            <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
              {f.name}
            </p>
            <p className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {held(f, t)}
            </p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              {lastUsed(f, t)}
            </p>
          </li>
        ))}
      </ul>
      <Button size="lg" tone="danger" className="mt-8" onClick={() => setRemoving(true)}>
        {t.secrets.removeManaged}
      </Button>
      <RemoveSheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={t.secrets.removeTitle(entry.name)}
        help={t.secrets.removeManagedHelp}
        stops={[]}
        extra={null}
        busy={busy}
        onConfirm={remove}
      />
    </Page>
  );
}

export function SecretEntryPage({
  session,
  entry,
  names,
  onBack,
  onChanged,
  onRenamed,
}: {
  session: Session;
  entry: SecretEntry;
  names: ProviderNames;
  onBack: () => void;
  /** after anything is changed: the entries are read again */
  onChanged: () => Promise<void>;
  onRenamed: (name: string) => void;
}) {
  if (entry.managed) return <ManagedPage session={session} entry={entry} names={names} onBack={onBack} onChanged={onChanged} />;
  return <Editable session={session} entry={entry} names={names} onBack={onBack} onChanged={onChanged} onRenamed={onRenamed} />;
}

function Editable({
  session,
  entry,
  names,
  onBack,
  onChanged,
  onRenamed,
}: {
  session: Session;
  entry: SecretEntry;
  names: ProviderNames;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onRenamed: (name: string) => void;
}) {
  const t = useT();
  const keys = useRef(0);
  const [name, setName] = useState(entry.name);
  const [note, setNote] = useState(entry.note);
  const [plain, setPlain] = useState<PlainRow[]>(() =>
    entry.plain.map((f) => ({ key: ++keys.current, name: f.name, role: f.role, draft: fromValue(f.value), fresh: false })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** the secret field whose value is being replaced, and the new one */
  const [replacing, setReplacing] = useState<{ name: string; draft: Draft } | null>(null);
  const [adding, setAdding] = useState<{ name: string; draft: Draft } | null>(null);
  const [addingUse, setAddingUse] = useState(false);
  const [removingField, setRemovingField] = useState<SecretField | null>(null);
  const [removing, setRemoving] = useState(false);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  /** do something to the entry, read the entries again, and then `done` */
  const run = (work: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(null);
    work()
      .then(() => onChanged())
      .then(() => done?.(), fail)
      .finally(() => setBusy(false));
  };

  const saved = JSON.stringify(entry.plain.map((f) => [f.name, f.role, fromValue(f.value)]));
  const unchanged =
    name === entry.name &&
    note === entry.note &&
    JSON.stringify(plain.map((f) => [f.name, f.role, f.draft])) === saved;
  const stuck = problem({
    name,
    plain: plain.map((f) => ({ name: f.name, draft: f.draft })),
    secret: entry.secret.map((f) => ({ name: f.name, draft: null })),
  });

  const save = () => {
    const inputs: PlainInput[] = plain.flatMap((f) => {
      const value = toValue(f.draft, f.name);
      return value ? [{ name: f.name.trim(), role: f.role, value }] : [];
    });
    const renamed = name.trim();
    run(() => session.call("secrets.edit", { id: entry.id, name: renamed, note, plain: inputs }), () => onRenamed(renamed));
  };
  const setPlainRow = (key: number, change: Partial<PlainRow>) =>
    setPlain((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const replace = () => {
    if (!replacing) return;
    const field = entry.secret.find((f) => f.name === replacing.name);
    const value = toValue(replacing.draft, replacing.name);
    if (!field || !value) return;
    run(() => session.call("secrets.setSecret", { id: entry.id, field: { name: field.name, role: field.role, value } }), () => setReplacing(null));
  };
  const addSecret = () => {
    if (!adding) return;
    const value = toValue(adding.draft, adding.name);
    const fieldName = adding.name.trim();
    if (!value || fieldName === "" || [...entry.plain, ...entry.secret].some((f) => f.name === fieldName)) return;
    run(() => session.call("secrets.setSecret", { id: entry.id, field: { name: fieldName, role: null, value } }), () => setAdding(null));
  };
  const addingOk =
    adding !== null &&
    toValue(adding.draft, adding.name) !== null &&
    adding.name.trim() !== "" &&
    ![...entry.plain, ...entry.secret].some((f) => f.name === adding.name.trim());

  const usesOf = (field: string) => entry.uses.filter((use) => use.field === field);
  const describe = (uses: SecretEntry["uses"]) => uses.map((use) => `${describeUse(use, names, t)} (${t.secrets.useFor(use.field)})`);
  const serverUse = (uses: SecretEntry["uses"]) => uses.some((use) => use.kind === "server");

  return (
    <Page onBack={onBack}>
      <div className="mt-2 flex flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-[14px]" style={{ background: "#ffffff", color: "#111112" }}>
          <KeyRound size={22} />
        </span>
        <p className="mt-2 text-[18px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {entry.name}
        </p>
        <p className="mt-0.5 text-[13px] [overflow-wrap:anywhere]" style={{ color: "var(--text-secondary)" }}>
          {usesSummary(entry, names, t)}
        </p>
      </div>
      <Alert message={error} />

      <Heading title={t.secrets.name} />
      <div className="rounded-[18px] px-4 py-2" style={{ background: "var(--fill-secondary)" }}>
        <input
          aria-label={t.secrets.name}
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
            onName={(n) => setPlainRow(f.key, { name: n })}
            draft={f.draft}
            onDraft={(draft) => setPlainRow(f.key, { draft })}
            secret={false}
            kindEditable={f.fresh}
            onRemove={() => setPlain((rows) => rows.filter((row) => row.key !== f.key))}
          />
        ))}
        <li className="py-1">
          <TextButton
            onClick={() => setPlain((rows) => [...rows, { key: ++keys.current, name: "", role: null, draft: blank("text"), fresh: true }])}
          >
            <Plus size={14} className="mr-1 inline" />
            {t.secrets.addDetail}
          </TextButton>
        </li>
      </ul>

      <Heading title={t.secrets.secretHeading} help={t.secrets.secretHelp} />
      <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
        {entry.secret.map((f) => (
          <li key={f.name} className="py-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {f.name}
                </span>
                <span className="block truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                  {held(f, t)}
                </span>
              </span>
              <TextButton onClick={() => setReplacing({ name: f.name, draft: blank(f.kind) })}>{t.secrets.replace}</TextButton>
              {entry.secret.length > 1 && (
                <button
                  aria-label={t.secrets.removeField(f.name)}
                  className="hover-fade flex size-7 shrink-0 items-center justify-center rounded-full"
                  style={{ color: "var(--icon-secondary)" }}
                  onClick={() => setRemovingField(f)}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              {lastUsed(f, t)}
            </p>
            {replacing?.name === f.name && (
              <div className="mt-2">
                <ValueEditor
                  draft={replacing.draft}
                  onChange={(draft) => setReplacing({ name: f.name, draft })}
                  secret
                  fallbackName={f.name}
                  look="page"
                  label={f.name}
                />
                <div className="mt-1 flex justify-end gap-2">
                  <TextButton tone="neutral" onClick={() => setReplacing(null)}>
                    {t.common.cancel}
                  </TextButton>
                  <TextButton disabled={busy || toValue(replacing.draft, f.name) === null} onClick={replace}>
                    {t.secrets.save}
                  </TextButton>
                </div>
              </div>
            )}
          </li>
        ))}
        {adding ? (
          <li className="py-3">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                aria-label={t.secrets.fieldName}
                placeholder={t.secrets.fieldName}
                maxLength={60}
                className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none"
                style={{ color: "var(--text-primary)" }}
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              />
              <KindToggle kind={adding.draft.kind} onChange={(kind) => setAdding({ ...adding, draft: blank(kind) })} />
            </div>
            <ValueEditor
              draft={adding.draft}
              onChange={(draft) => setAdding({ ...adding, draft })}
              secret
              fallbackName={adding.name}
              look="page"
              label={adding.name || t.secrets.fieldName}
            />
            <div className="mt-1 flex justify-end gap-2">
              <TextButton tone="neutral" onClick={() => setAdding(null)}>
                {t.common.cancel}
              </TextButton>
              <TextButton disabled={busy || !addingOk} onClick={addSecret}>
                {t.common.add}
              </TextButton>
            </div>
          </li>
        ) : (
          <li className="py-1">
            <TextButton onClick={() => setAdding({ name: "", draft: blank("text") })}>
              <Plus size={14} className="mr-1 inline" />
              {t.secrets.addSecret}
            </TextButton>
          </li>
        )}
      </ul>

      <Heading title={t.secrets.noteHeading} help={t.secrets.noteHelp} />
      <NoteField value={note} onChange={setNote} />

      {stuck && !unchanged && (
        <p className="mt-4 px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {t.secrets.problem[stuck]}
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-4" disabled={unchanged || stuck !== null || busy} onClick={save}>
        {t.secrets.save}
      </Button>

      <Heading title={t.secrets.usesHeading} />
      <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
        {entry.uses.length === 0 && (
          <li className="py-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
            {t.secrets.noUses}
          </li>
        )}
        {entry.uses.map((use) => (
          <li key={use.id} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]" style={{ color: "var(--text-primary)" }}>
                {describeUse(use, names, t)}
              </span>
              <span className="block truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {t.secrets.useFor(use.field)}
              </span>
            </span>
            <TextButton
              tone="danger"
              disabled={busy}
              onClick={() => run(() => session.call("secrets.unuse", { id: entry.id, use: use.id }))}
            >
              {t.common.remove}
            </TextButton>
          </li>
        ))}
      </ul>
      {addingUse ? (
        <UseForm
          fields={[...entry.plain.map((f) => ({ id: f.name, name: f.name, kind: f.value.kind })), ...entry.secret.map((f) => ({ id: f.name, name: f.name, kind: f.kind }))]}
          busy={busy}
          onCancel={() => setAddingUse(false)}
          onAdd={(field, spec) => run(() => session.call("secrets.use", { id: entry.id, use: useOf(field, spec) }), () => setAddingUse(false))}
        />
      ) : (
        <div className="mt-1">
          <TextButton onClick={() => setAddingUse(true)}>{t.secrets.addUse}</TextButton>
        </div>
      )}

      <Button size="lg" tone="danger" className="mt-8" onClick={() => setRemoving(true)}>
        {t.secrets.removeEntry}
      </Button>

      <RemoveSheet
        open={removingField !== null}
        onClose={() => setRemovingField(null)}
        title={t.secrets.removeFieldTitle(removingField?.name ?? "")}
        help={t.secrets.removeFieldHelp}
        stops={describe(usesOf(removingField?.name ?? ""))}
        extra={serverUse(usesOf(removingField?.name ?? "")) ? t.secrets.removeServer : null}
        busy={busy}
        onConfirm={() => {
          const field = removingField;
          if (field) run(() => session.call("secrets.removeSecret", { id: entry.id, name: field.name }), () => setRemovingField(null));
        }}
      />
      <RemoveSheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={t.secrets.removeTitle(entry.name)}
        help={t.secrets.removeHelp}
        stops={describe(entry.uses)}
        extra={serverUse(entry.uses) ? t.secrets.removeServer : null}
        busy={busy}
        onConfirm={() => run(() => session.call("secrets.remove", { id: entry.id }), () => setRemoving(false))}
      />
    </Page>
  );
}
