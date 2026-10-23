/**
 * The pieces the Vault's forms and Amuse's card for a secret have in common: a value to type, choose or paste
 * (a line of text, or a file), a field with its name, a note.
 */
import { type ReactNode, useRef, useState } from "react";
import { ChevronLeft, KeyRound, Trash2 } from "lucide-react";
import { type FieldKind, MAX_TEXT, fileSize } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
import { type Draft, FILE_KB, blank, formatSize, pasted, readFile, tooBig } from "../secrets.ts";

/** A list of fields, as a settings page draws one. */
export const groupClass = "divide-y divide-[var(--fill-divider)] rounded-[18px] px-4";

/** `card`: in a chat card, on the field colour; `page`: in a settings list, on its own. */
export type Look = "card" | "page";

const text = {
  card: "h-10 w-full rounded-[12px] px-3 text-[14px] outline-none",
  page: "w-full bg-transparent py-1.5 text-[16px] outline-none",
};
const fill = (look: Look) => (look === "card" ? { background: "var(--field)", color: "var(--text-primary)" } : { color: "var(--text-primary)" });

/** A page of the Vault: scrolls, and on a desktop has its own way back to the list (a phone's is in the settings' bar). */
export function Page({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 sm:px-6">
      <button
        aria-label={t.common.back}
        className="hover-fade hidden size-8 shrink-0 items-center justify-center rounded-full sm:flex"
        style={{
          background: "var(--fill-primary)",
          color: "var(--icon-primary)",
          boxShadow: "var(--shadow-float)",
        }}
        onClick={onBack}
      >
        <ChevronLeft size={18} />
      </button>
      {children}
    </div>
  );
}

/** What went wrong, in the server's words. */
export function Alert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 px-1 text-[13px]" style={{ color: "var(--fill-red)" }}>
      {message}
    </p>
  );
}

/** A heading over a group, with a line of help. */
export function Heading({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-2 mt-6 px-1">
      <p className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
        {title}
      </p>
      {help && (
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          {help}
        </p>
      )}
    </div>
  );
}

/** A small text button in a field's row or a form: blue, red for what takes something away, or plain for Cancel. */
export function TextButton({
  children,
  onClick,
  tone = "accent",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "accent" | "danger" | "neutral";
  disabled?: boolean;
}) {
  return (
    <Button variant="plain" {...(tone === "neutral" ? {} : { tone })} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

/** A value to give: a line of text (hidden for a secret), or a file to choose or to paste the text of. */
export function ValueEditor({
  draft,
  onChange,
  secret,
  fallbackName,
  look,
  label,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  secret: boolean;
  /** what a pasted file is called when it is not given a name: the field's */
  fallbackName: string;
  look: Look;
  label: string;
}) {
  const t = useT();
  if (draft.kind === "text")
    return (
      <input
        type={secret ? "password" : "text"}
        autoComplete="off"
        aria-label={label}
        placeholder={t.secrets.valuePlaceholder}
        maxLength={MAX_TEXT}
        className={text[look]}
        style={fill(look)}
        value={draft.text}
        onChange={(e) => onChange({ kind: "text", text: e.target.value })}
      />
    );
  return <FileEditor filename={draft.filename} content={draft.content} onChange={onChange} fallbackName={fallbackName} look={look} label={label} />;
}

function FileEditor({
  filename,
  content,
  onChange,
  fallbackName,
  look,
  label,
}: {
  filename: string;
  content: string;
  onChange: (draft: Draft) => void;
  fallbackName: string;
  look: Look;
  label: string;
}) {
  const t = useT();
  const [pasting, setPasting] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const choose = (file: File | undefined) => {
    if (!file) return;
    void readFile(file).then((read) => {
      if (typeof read !== "string") {
        setError(null);
        return onChange(read);
      }
      setError(
        read === "tooBig" ? t.secrets.fileTooBig(FILE_KB) : read === "empty" ? t.secrets.fileEmpty : t.secrets.fileUnreadable,
      );
    });
  };
  const switchTo = (paste: boolean) => {
    setPasting(paste);
    setTyped("");
    setError(null);
    onChange(blank("file"));
  };
  const box = look === "card" ? "rounded-[12px] px-3 py-2" : "py-1.5";
  const boxFill = look === "card" ? { background: "var(--field)" } : undefined;
  const big = tooBig({ kind: "file", filename, content });

  return (
    <div>
      <input
        ref={picker}
        type="file"
        aria-label={label}
        className="hidden"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {pasting ? (
        <div className={box} style={boxFill}>
          <textarea
            aria-label={t.secrets.pasteHere}
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={t.secrets.pasteHere}
            className="w-full resize-none bg-transparent font-mono text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              onChange(pasted(e.target.value, filename));
            }}
          />
          <input
            aria-label={t.secrets.fileNamePlaceholder("")}
            placeholder={t.secrets.fileNamePlaceholder(fallbackName.trim())}
            maxLength={255}
            className="mt-1 w-full bg-transparent text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
            value={filename}
            onChange={(e) => onChange({ kind: "file", filename: e.target.value, content })}
          />
        </div>
      ) : (
        <div className={`flex items-center gap-2 ${box}`} style={boxFill}>
          {content ? (
            <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: "var(--text-primary)" }}>
              {filename} <span style={{ color: "var(--text-secondary)" }}>· {formatSize(fileSize(content))}</span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <TextButton onClick={() => picker.current?.click()}>{content ? t.secrets.replace : t.secrets.chooseFile}</TextButton>
        </div>
      )}
      {(error || big) && (
        <p role="alert" className="mt-1 text-[12px]" style={{ color: "var(--fill-red)" }}>
          {error ?? t.secrets.fileTooBig(FILE_KB)}
        </p>
      )}
      <div className="mt-0.5 flex">
        <TextButton onClick={() => switchTo(!pasting)}>{pasting ? t.secrets.chooseInstead : t.secrets.pasteInstead}</TextButton>
      </div>
    </div>
  );
}

/** Text or file. */
export function KindToggle({ kind, onChange }: { kind: FieldKind; onChange: (kind: FieldKind) => void }) {
  const t = useT();
  const kinds: { kind: FieldKind; label: string }[] = [
    { kind: "text", label: t.secrets.text },
    { kind: "file", label: t.secrets.file },
  ];
  return (
    <span className="flex shrink-0 rounded-full p-0.5" style={{ background: "var(--field)" }}>
      {kinds.map((k) => (
        <button
          key={k.kind}
          type="button"
          aria-pressed={kind === k.kind}
          className="rounded-full px-2.5 py-0.5 text-[12px] font-medium"
          style={{
            background: kind === k.kind ? "var(--fill-primary)" : "transparent",
            color: "var(--text-primary)",
          }}
          onClick={() => kind !== k.kind && onChange(k.kind)}
        >
          {k.label}
        </button>
      ))}
    </span>
  );
}

/** A field being written in a form: its name, and its value. A new one chooses text or file; every one can be taken away. */
export function FieldRow({
  name,
  onName,
  draft,
  onDraft,
  secret,
  kindEditable,
  onRemove,
}: {
  name: string;
  onName: (name: string) => void;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  secret: boolean;
  kindEditable: boolean;
  /** none: it cannot be taken away (a secret field, when it is the only one) */
  onRemove: (() => void) | null;
}) {
  const t = useT();
  return (
    <li className="py-3">
      <div className="flex items-center gap-2">
        <input
          aria-label={t.secrets.fieldName}
          placeholder={t.secrets.fieldName}
          maxLength={60}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none"
          style={{ color: "var(--text-primary)" }}
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
        {kindEditable && <KindToggle kind={draft.kind} onChange={(kind) => onDraft(blank(kind))} />}
        {onRemove && (
          <button
            type="button"
            aria-label={t.secrets.removeField(name)}
            className="hover-fade flex size-7 shrink-0 items-center justify-center rounded-full"
            style={{ color: "var(--icon-secondary)" }}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <ValueEditor draft={draft} onChange={onDraft} secret={secret} fallbackName={name} look="page" label={name || t.secrets.fieldName} />
    </li>
  );
}

/** The note, with the warning that it is not a place for secrets. */
export function NoteField({ value, onChange }: { value: string; onChange: (note: string) => void }) {
  const t = useT();
  return (
    <>
      <div className="rounded-[18px] px-4 py-3" style={{ background: "var(--fill-secondary)" }}>
        <textarea
          aria-label={t.secrets.noteHeading}
          rows={3}
          maxLength={2000}
          className="w-full resize-none bg-transparent text-[16px] outline-none"
          style={{ color: "var(--text-primary)" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <p className="mt-1.5 px-1 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
        {t.secrets.noteWarning}
      </p>
    </>
  );
}

/** Asking before something is taken away: what it is, what stops working with it, and the button. */
export function RemoveSheet({
  open,
  onClose,
  title,
  help,
  stops,
  extra,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  help: string;
  /** what stops working, one in a line */
  stops: string[];
  extra: string | null;
  busy: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <ConfirmSheet open={open} onClose={onClose} icon={KeyRound} title={title} body={help} action={t.common.remove} busy={busy} onConfirm={onConfirm}>
      <div className="max-h-56 w-full overflow-y-auto text-left">
        {stops.length > 0 && (
          <div className="mt-3">
            <p className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {t.secrets.willStop}
            </p>
            <ul className="mt-1 list-disc pl-5 text-[14px]" style={{ color: "var(--text-primary)" }}>
              {stops.map((line, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        {extra && (
          <p className="mt-2 text-[14px]" style={{ color: "var(--text-primary)" }}>
            {extra}
          </p>
        )}
      </div>
    </ConfirmSheet>
  );
}
