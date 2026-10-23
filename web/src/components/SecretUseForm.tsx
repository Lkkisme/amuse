/**
 * Adding a use to a secret: a field goes into the sandbox as an environment variable, or as a file in its home
 * folder (with a variable that holds the file's path, if wanted). Uses of the server's own services are not made here:
 * the model, voice and connection settings make those.
 */
import { useState } from "react";
import type { FieldKind } from "@amuse/protocol";
import { Button } from "./Button";
import { useT } from "../i18n/react.ts";
import { type UseSpec, validEnv, validPath } from "../secrets.ts";

/** A field a use can be for; `id` is how the caller tells it (a form not yet saved has no names to rely on). */
export interface UsableField {
  id: string;
  name: string;
  kind: FieldKind;
}

const input = "w-full rounded-[12px] px-3 py-2 text-[15px] outline-none";
const inputStyle = { background: "var(--field)", color: "var(--text-primary)" };

/** An environment variable's name as typed: upper case, and only what a name can have. */
const envTyped = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9_]/g, "");

export function UseForm({
  fields,
  busy = false,
  onAdd,
  onCancel,
}: {
  fields: UsableField[];
  busy?: boolean;
  onAdd: (field: string, spec: UseSpec) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [field, setField] = useState(fields[0]?.id ?? "");
  const [how, setHow] = useState<"env" | "file">("env");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [alsoSet, setAlsoSet] = useState(false);
  const [pathName, setPathName] = useState("");

  const chosen = fields.find((f) => f.id === field) ?? fields[0];
  const ok = chosen !== undefined && (how === "env" ? validEnv(name) : validPath(path) && (!alsoSet || validEnv(pathName)));
  const add = () => {
    if (!chosen || !ok) return;
    onAdd(chosen.id, how === "env" ? { kind: "env", name } : { kind: "file", path, env: alsoSet ? pathName : null });
  };
  const hows: { how: "env" | "file"; label: string }[] = [
    { how: "env", label: t.secrets.useEnv },
    { how: "file", label: t.secrets.useFile },
  ];
  // what a value of one kind becomes as the other: said once the choice makes it so
  const converts = chosen && (how === "file" && chosen.kind === "text" ? t.secrets.textAsFile : how === "env" && chosen.kind === "file" ? t.secrets.fileAsEnv : null);

  return (
    <form
      className="mt-3 rounded-[18px] p-4"
      style={{ background: "var(--fill-secondary)" }}
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      {fields.length > 1 && (
        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {t.secrets.useField}
          </span>
          <select className={input} style={inputStyle} value={chosen?.id ?? ""} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mb-3 flex gap-2">
        {hows.map((h) => (
          <button
            key={h.how}
            type="button"
            aria-pressed={how === h.how}
            className="h-8 flex-1 rounded-full text-[14px] font-medium"
            style={{
              background: how === h.how ? "var(--fill-primary)" : "var(--field)",
              color: "var(--text-primary)",
            }}
            onClick={() => setHow(h.how)}
          >
            {h.label}
          </button>
        ))}
      </div>
      {how === "env" ? (
        <input
          autoFocus
          aria-label={t.secrets.varName}
          placeholder="API_TOKEN"
          maxLength={64}
          spellCheck={false}
          autoCapitalize="characters"
          className={`${input} font-mono`}
          style={inputStyle}
          value={name}
          onChange={(e) => setName(envTyped(e.target.value))}
        />
      ) : (
        <>
          <input
            autoFocus
            aria-label={t.secrets.filePath}
            placeholder={t.secrets.filePath}
            maxLength={1024}
            spellCheck={false}
            className={`${input} font-mono`}
            style={inputStyle}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          {chosen?.kind === "file" && (
            <>
              <label className="mt-3 flex items-center gap-2 text-[14px]" style={{ color: "var(--text-primary)" }}>
                <input type="checkbox" checked={alsoSet} onChange={(e) => setAlsoSet(e.target.checked)} />
                {t.secrets.alsoSet}
              </label>
              {alsoSet && (
                <input
                  aria-label={t.secrets.varName}
                  placeholder="CREDENTIALS_FILE"
                  maxLength={64}
                  spellCheck={false}
                  autoCapitalize="characters"
                  className={`${input} mt-2 font-mono`}
                  style={inputStyle}
                  value={pathName}
                  onChange={(e) => setPathName(envTyped(e.target.value))}
                />
              )}
            </>
          )}
        </>
      )}
      {converts && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {converts}
        </p>
      )}
      <p className="mt-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
        {t.secrets.sandboxNote}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="plain" type="button" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={!ok || busy}>
          {t.common.add}
        </Button>
      </div>
    </form>
  );
}
