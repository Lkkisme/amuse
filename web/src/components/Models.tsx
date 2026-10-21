/**
 * Settings › Models: the model Muse chats with and the one that works in the
 * browser (it must see pictures), among those of the providers set up with
 * the user's own API keys; the providers set up (only the end of a key shows),
 * and every other one to add.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import type {
  KeyProvider,
  KeysState,
  ModelRole,
  Session,
} from "@remuse/protocol";
import { KeyLogin } from "./KeyLogin";

const label = "mb-2 mt-6 px-1 text-[13px] font-medium";
const group = "divide-y divide-[var(--fill-divider)] rounded-[18px] px-4";

export function Models({ session }: { session: Session }) {
  const [state, setState] = useState<KeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState<KeyProvider | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    () =>
      session.call("keys.list", {}).then(
        (s) => setState(s),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [session],
  );
  useEffect(() => void load(), [load]);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const choose = (role: ModelRole, model: string) => {
    setError(null);
    session.call("models.choose", { role, model }).then(load, fail);
  };
  const forget = (provider: KeyProvider) => {
    setError(null);
    session.call("keys.logout", { provider: provider.id }).then(load, fail);
  };

  const providers = state?.providers.filter((p) => p.use === "models") ?? [];
  const mine = providers.filter((p) => p.connected);
  const words = query.trim().toLowerCase();
  const others = providers.filter(
    (p) =>
      !p.connected &&
      (!words || p.name.toLowerCase().includes(words) || p.id.includes(words)),
  );
  const models = state?.models ?? [];

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        Muse runs on a model you choose, with your own API key.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}

      {mine.length > 0 && state && (
        <>
          <p className={label} style={{ color: "var(--text-secondary)" }}>
            Models
          </p>
          <div
            className={group}
            style={{ background: "var(--fill-secondary)" }}
          >
            <ModelPicker
              title="Chat"
              value={state.chat}
              options={models}
              onChange={(m) => choose("chat", m)}
            />
            <ModelPicker
              title="Browser"
              value={state.browser}
              options={models.filter((m) => m.images)}
              onChange={(m) => choose("browser", m)}
            />
          </div>
          <p className={label} style={{ color: "var(--text-secondary)" }}>
            Your providers
          </p>
          <ul className={group} style={{ background: "var(--fill-secondary)" }}>
            {mine.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[16px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {p.name}
                  </span>
                  {p.hint && (
                    <span
                      className="block text-[13px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Key {p.hint}
                    </span>
                  )}
                </span>
                <button
                  className="hover-fade rounded-full px-2 py-1 text-[14px] font-medium"
                  style={{ color: "var(--fill-blue)" }}
                  onClick={() => setSetting(p)}
                >
                  Replace
                </button>
                <button
                  aria-label={`Remove the key for ${p.name}`}
                  className="hover-fade rounded-full p-1"
                  style={{ color: "var(--icon-secondary)" }}
                  onClick={() => forget(p)}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={label} style={{ color: "var(--text-secondary)" }}>
        {mine.length > 0 ? "Add a provider" : "Choose a provider to start"}
      </p>
      <label
        className="mb-2 flex items-center gap-2 rounded-full px-4 py-2.5"
        style={{ background: "var(--field)" }}
      >
        <Search size={16} style={{ color: "var(--icon-secondary)" }} />
        <input
          aria-label="Search providers"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Search providers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className={group} style={{ background: "var(--fill-secondary)" }}>
        {state === null && <li className="skeleton my-3 h-6 rounded" />}
        {state && others.length === 0 && (
          <li
            className="py-3.5 text-[15px]"
            style={{ color: "var(--text-secondary)" }}
          >
            No provider by that name.
          </li>
        )}
        {others.map((p) => (
          <li key={p.id}>
            <button
              className="flex w-full items-center gap-3 py-3 text-left"
              onClick={() => setSetting(p)}
            >
              <span
                className="min-w-0 flex-1 truncate text-[16px]"
                style={{ color: "var(--text-primary)" }}
              >
                {p.name}
              </span>
              <ChevronRight
                size={16}
                style={{ color: "var(--icon-secondary)" }}
              />
            </button>
          </li>
        ))}
      </ul>

      <KeyLogin
        session={session}
        provider={setting}
        onClose={(done) => {
          setSetting(null);
          if (done) void load();
        }}
      />
    </div>
  );
}

/** One role's model: the providers' models to choose from (none chosen yet: said so). */
function ModelPicker({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: string | null;
  options: KeysState["models"];
  onChange: (model: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-2.5">
      <span className="text-[16px]" style={{ color: "var(--text-primary)" }}>
        {title}
      </span>
      <select
        aria-label={`${title} model`}
        className="min-w-0 flex-1 truncate bg-transparent text-right text-[15px] outline-none"
        style={{ color: value ? "var(--text-secondary)" : "var(--fill-blue)" }}
        value={value ?? ""}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      >
        {!value && <option value="">Choose a model</option>}
        {value && !options.some((o) => o.id === value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
