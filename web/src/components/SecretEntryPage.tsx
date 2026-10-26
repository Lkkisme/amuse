/**
 * One entry of the Vault, as a phone's password manager shows one: a plain list of what it holds (a small label, its
 * value below; a secret as dots, with an eye and a copy button), where it is used, and the note last. The page's one
 * button, top right, opens Edit and Remove. Edit is the same few boxes as adding; where it is used lives under Advanced.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Eye, EyeOff, MoreHorizontal } from "lucide-react";
import type { PlainField, PlainInput, SecretEntry, SecretField, Session } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";
import { wordsOf } from "../shown.ts";
import { useFail } from "../ask.tsx";
import {
  type ProviderNames,
  CLIPBOARD_MS,
  REVEAL_MS,
  computerName,
  copy,
  describeUse,
  labelOf,
  pasted,
  toValue,
  useOf,
  useSentence,
  valueText,
} from "../secrets.ts";
import { Box, BoxRow, InfoRow, NoteRow, Page, RemoveSheet, TextButton, groupClass } from "./SecretFields";
import { Button } from "./Button";
import { barButton, barButtonLook, barIcon } from "./bar";
import { UseForm } from "./SecretUseForm";

const message = wordsOf;

/** A small round button beside a value. */
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      className="hover-fade flex size-9 shrink-0 items-center justify-center rounded-full"
      style={{ color: "var(--icon-secondary)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Copy, which says it did for a moment. */
function CopyButton({ get, clearAfter, onError }: { get: () => Promise<string>; clearAfter: number | null; onError: (e: unknown) => void }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = () =>
    get()
      .then((value) => copy(value, clearAfter))
      .then(() => {
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1500);
      }, onError);
  return (
    <IconButton label={done ? t.secrets.copied : t.secrets.copy} onClick={click}>
      {done ? <Check size={17} style={{ color: "var(--fill-green)" }} /> : <Copy size={17} />}
    </IconButton>
  );
}

/** A plain value: it is there to read, and to copy. A file an old entry holds is told by its name. */
function PlainRow({ field, onError }: { field: PlainField; onError: (e: unknown) => void }) {
  const t = useT();
  const text = valueText(field.value);
  return (
    <InfoRow
      label={labelOf(field.name, field.role, t)}
      side={text !== null && <CopyButton get={async () => text} clearAfter={null} onError={onError} />}
    >
      {field.value.kind === "text" ? field.value.text : field.value.filename}
    </InfoRow>
  );
}

/** A secret: dots until the eye is tapped (which asks the server, and hides again after a while); copying it copies the real value. */
function SecretRow({ session, entry, field, onError }: { session: Session; entry: SecretEntry; field: SecretField; onError: (e: unknown) => void }) {
  const t = useT();
  const [value, setValue] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fetch = () => session.call("secrets.reveal", { id: entry.id, field: field.name }).then(({ value: revealed }) => revealed);
  const hide = () => {
    clearTimeout(timer.current);
    setValue(null);
  };
  const toggle = () => {
    if (value !== null) return hide();
    fetch().then((revealed) => {
      setValue(revealed);
      timer.current = setTimeout(hide, REVEAL_MS);
    }, onError);
  };
  return (
    <InfoRow
      label={labelOf(field.name, field.role, t)}
      side={
        <>
          <IconButton label={value === null ? t.secrets.show : t.secrets.hide} onClick={toggle}>
            {value === null ? <Eye size={17} /> : <EyeOff size={17} />}
          </IconButton>
          <CopyButton get={async () => value ?? (await fetch())} clearAfter={CLIPBOARD_MS} onError={onError} />
        </>
      }
    >
      {/* shown or hidden, the row keeps its height: one line, a long value scrolls sideways */}
      <span className={`touch-no-scrollbar block h-6 overflow-x-auto whitespace-nowrap leading-6 ${value === null ? "" : "font-mono"}`}>
        {value ?? "••••••"}
      </span>
    </InfoRow>
  );
}

/** The ⋯ button and the menu it opens. */
function Actions({ name, items }: { name: string; items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        aria-label={t.secrets.options(name)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={barButton}
        style={barButtonLook}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={barIcon} />
      </button>
      {open && (
        <div
          role="menu"
          className="anim-popover-in absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-2xl p-1"
          style={{ background: "var(--fill-primary)", boxShadow: "var(--shadow-float)" }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className="hover-fade block w-full rounded-xl px-3 py-2 text-left text-[14px]"
              style={{ color: item.danger ? "var(--fill-red)" : "var(--text-primary)" }}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const failed = useFail();
  const fail = (e: unknown) => failed(e, "Vault › read an entry");

  const remove = () => {
    setBusy(true);
    session
      .call("secrets.remove", { id: entry.id })
      .then(() => onChanged())
      .then(() => setRemoving(false), (e: unknown) => failed(e, "Vault › remove an entry", remove))
      .finally(() => setBusy(false));
  };

  if (editing && !entry.managed)
    return <Editing session={session} entry={entry} names={names} onBack={onBack} onDone={() => setEditing(false)} onChanged={onChanged} onRenamed={onRenamed} />;

  const serverUse = entry.uses.some((use) => use.kind === "server");
  return (
    <Page
      onBack={onBack}
      actions={
        <Actions
          name={entry.name}
          items={
            entry.managed
              ? [{ label: t.secrets.removeManaged, danger: true, onClick: () => setRemoving(true) }]
              : [
                  { label: t.secrets.edit, onClick: () => setEditing(true) },
                  { label: t.common.remove, danger: true, onClick: () => setRemoving(true) },
                ]
          }
        />
      }
    >
      <ul className={`${groupClass} mt-4`} style={{ background: "var(--fill-secondary)" }}>
        {entry.managed ? (
          <InfoRow label={t.secrets.signInLabel}>
            <span className="block">{t.secrets.signedIn}</span>
            <span className="block text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {t.secrets.signedInNote}
            </span>
          </InfoRow>
        ) : (
          <>
            {entry.plain.map((field) => (
              <PlainRow key={field.name} field={field} onError={fail} />
            ))}
            {entry.secret.map((field) => (
              <SecretRow key={field.name} session={session} entry={entry} field={field} onError={fail} />
            ))}
          </>
        )}
        <InfoRow label={t.secrets.usedHeading}>
          {entry.uses.length === 0 ? (
            <span style={{ color: "var(--text-secondary)" }}>{t.secrets.noUses}</span>
          ) : (
            entry.uses.map((use) => (
              <span key={use.id} className="block">
                {useSentence(use, names, t)}
              </span>
            ))
          )}
        </InfoRow>
        {entry.note !== "" && (
          <InfoRow label={t.secrets.note}>
            <span className="whitespace-pre-wrap">{entry.note}</span>
          </InfoRow>
        )}
      </ul>
      <RemoveSheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={t.secrets.removeTitle(entry.name)}
        help={entry.managed ? t.secrets.removeManagedHelp : t.secrets.removeHelp}
        stops={entry.managed ? [] : entry.uses.map((use) => describeUse(use, names, t))}
        extra={serverUse && !entry.managed ? t.secrets.removeServer : null}
        busy={busy}
        onConfirm={remove}
      />
    </Page>
  );
}

/** What a plain field is edited as: its text, or for an old file a box to paste a replacement (empty keeps it). */
function plainStart(field: PlainField): string {
  return field.value.kind === "text" ? field.value.text : "";
}

function Editing({
  session,
  entry,
  names,
  onBack,
  onDone,
  onChanged,
  onRenamed,
}: {
  session: Session;
  entry: SecretEntry;
  names: ProviderNames;
  onBack: () => void;
  onDone: () => void;
  onChanged: () => Promise<void>;
  onRenamed: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(entry.name);
  const [note, setNote] = useState(entry.note);
  const [plain, setPlain] = useState(() => new Map(entry.plain.map((f) => [f.name, plainStart(f)])));
  /** a new value for a secret, by its name; none typed keeps it */
  const [secret, setSecret] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [addingUse, setAddingUse] = useState(false);

  const failed = useFail();
  const run = (work: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    work()
      .then(() => onChanged())
      .then(() => done?.(), (e: unknown) => failed(e, "Vault › save an entry", () => run(work, done)))
      .finally(() => setBusy(false));
  };

  /** the plain value a field is saved with: what is typed, or the old file kept */
  const plainValue = (field: PlainField) => {
    const typed = plain.get(field.name) ?? "";
    if (field.value.kind === "file") return typed === "" ? field.value : toValue(pasted(typed, field.value.filename), field.name);
    return toValue({ kind: "text", text: typed }, field.name);
  };
  const plainInputs: PlainInput[] = entry.plain.flatMap((field) => {
    const value = plainValue(field);
    return value ? [{ name: field.name, role: field.role, value }] : [];
  });
  const typedSecrets = entry.secret.flatMap((field) => {
    const typed = secret.get(field.name) ?? "";
    if (typed === "") return [];
    const value = field.kind === "file" ? toValue(pasted(typed, field.filename ?? field.name), field.name) : toValue({ kind: "text", text: typed.trim() }, field.name);
    return [{ field, value }];
  });
  const stuck = name.trim() === "" ? t.secrets.problem.name : plainInputs.length < entry.plain.length || typedSecrets.some((s) => s.value === null) ? t.secrets.problem.value : null;
  const unchanged =
    name === entry.name &&
    note === entry.note &&
    typedSecrets.length === 0 &&
    entry.plain.every((field) => field.value.kind === "file" ? plain.get(field.name) === "" : plain.get(field.name) === field.value.text);

  const save = () => {
    const renamed = name.trim();
    run(
      async () => {
        await session.call("secrets.edit", { id: entry.id, name: renamed, note, plain: plainInputs });
        for (const { field, value } of typedSecrets) if (value) await session.call("secrets.setSecret", { id: entry.id, field: { name: field.name, role: field.role, value } });
      },
      () => {
        onRenamed(renamed);
        onDone();
      },
    );
  };

  return (
    <Page onBack={onBack}>
      <ul className={`${groupClass} mt-4`} style={{ background: "var(--fill-secondary)" }}>
        <BoxRow label={t.secrets.name}>
          <Box value={name} onChange={setName} max={100} />
        </BoxRow>
        {entry.plain.map((field) => (
          <BoxRow key={field.name} label={labelOf(field.name, field.role, t)}>
            <Box
              lines={field.value.kind === "file"}
              value={plain.get(field.name) ?? ""}
              onChange={(text) => setPlain(new Map(plain).set(field.name, text))}
              placeholder={field.value.kind === "file" ? t.secrets.pastePlaceholder : undefined}
            />
            {field.value.kind === "file" && (
              <span className="block text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {field.value.filename}
              </span>
            )}
          </BoxRow>
        ))}
        {entry.secret.map((field) => (
          <BoxRow key={field.name} label={labelOf(field.name, field.role, t)}>
            <Box
              hidden
              lines={field.kind === "file"}
              value={secret.get(field.name) ?? ""}
              onChange={(text) => setSecret(new Map(secret).set(field.name, text))}
              placeholder={field.kind === "file" ? t.secrets.pastePlaceholder : t.secrets.keepPlaceholder}
            />
          </BoxRow>
        ))}
        <NoteRow value={note} onChange={setNote} />
      </ul>

      <details className="mt-4 rounded-[18px] px-4" style={{ background: "var(--fill-secondary)" }}>
        <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[15px] [&::-webkit-details-marker]:hidden" style={{ color: "var(--text-primary)" }}>
          {t.secrets.advanced}
          <ChevronDown size={16} style={{ color: "var(--icon-secondary)" }} />
        </summary>
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          {t.secrets.advancedHelp}
        </p>
        <p className="mt-3 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {t.secrets.usedHeading}
        </p>
        <ul className="divide-y divide-[var(--fill-divider)]">
          {entry.uses.length === 0 && (
            <li className="py-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
              {t.secrets.noUses}
            </li>
          )}
          {entry.uses.map((use) => (
            <li key={use.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: "var(--text-primary)" }}>
                {describeUse(use, names, t)}
              </span>
              <TextButton tone="danger" disabled={busy} onClick={() => run(() => session.call("secrets.unuse", { id: entry.id, use: use.id }))}>
                {t.common.remove}
              </TextButton>
            </li>
          ))}
        </ul>
        {addingUse ? (
          <div className="pb-4">
            <UseForm
              fields={[...entry.plain.map((f) => ({ id: f.name, name: labelOf(f.name, f.role, t), kind: f.value.kind })), ...entry.secret.map((f) => ({ id: f.name, name: labelOf(f.name, f.role, t), kind: f.kind }))]}
              busy={busy}
              onCancel={() => setAddingUse(false)}
              onAdd={(field, spec) => run(() => session.call("secrets.use", { id: entry.id, use: useOf(field, spec) }), () => setAddingUse(false))}
            />
          </div>
        ) : (
          <div className="pb-2">
            <Button variant="plain" tone="accent" className="-ml-4" onClick={() => setAddingUse(true)}>
              {t.secrets.addUse}
            </Button>
          </div>
        )}
      </details>

      {stuck && !unchanged && (
        <p className="mt-4 px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {stuck}
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-4" disabled={unchanged || stuck !== null || busy} onClick={save}>
        {t.secrets.save}
      </Button>
      <Button variant="plain" size="lg" className="mt-2" onClick={onDone}>
        {t.common.cancel}
      </Button>
    </Page>
  );
}
