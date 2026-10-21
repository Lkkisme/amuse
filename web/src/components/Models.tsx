/**
 * Settings › Models: the model Muse chats with and the one that works in the
 * browser (it must see pictures), among those of the providers set up with
 * the user's own API keys; the providers set up (only the end of a key
 * shows), each with a page of its own to test, replace or remove its key; and
 * every other one to add.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound, Search } from "lucide-react";
import type {
  KeyProvider,
  KeysState,
  ModelRole,
  Session,
  ThinkingLevel,
} from "@amuse/protocol";
import { KeyLine, KeyLogin, type TestState, useKeyTests } from "./KeyLogin";

const label = "mb-2 mt-6 px-1 text-[13px] font-medium";
const group = "divide-y divide-[var(--fill-divider)] rounded-[18px] px-4";

/** `viewing`: the provider whose page is open (the settings' own state, so a phone's back button can leave it). */
export function Models({
  session,
  viewing,
  onView,
}: {
  session: Session;
  viewing: KeyProvider | null;
  onView: (provider: KeyProvider | null) => void;
}) {
  const [state, setState] = useState<KeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState<KeyProvider | null>(null);
  const { tests, test, clear } = useKeyTests(session);
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
  const choose = (role: ModelRole, model: string | null) => {
    setError(null);
    session.call("models.choose", { role, model }).then(load, fail);
  };
  const think = (role: ModelRole, level: ThinkingLevel) => {
    setError(null);
    session.call("models.think", { role, level }).then(load, fail);
  };
  const voice = (provider: string | null) => {
    setError(null);
    session.call("models.voice", { provider }).then(load, fail);
  };
  const forget = (provider: KeyProvider) => {
    setError(null);
    clear(provider.id);
    onView(null);
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
  // the page shows the provider as it is now (its key may have been replaced)
  const open =
    viewing && (providers.find((p) => p.id === viewing.id) ?? viewing);

  const sheet = (
    <KeyLogin
      session={session}
      provider={setting}
      onClose={(done) => {
        // a key just set up is tried at once
        if (done && setting) test(setting.id);
        setSetting(null);
        if (done) void load();
      }}
    />
  );

  if (open)
    return (
      <ProviderPage
        provider={open}
        test={tests[open.id]}
        uses={(["chat", "browser"] satisfies ModelRole[]).filter((role) =>
          state?.[role]?.startsWith(`${open.id}/`),
        )}
        onBack={() => onView(null)}
        onTest={() => test(open.id)}
        onReplace={() => setSetting(open)}
        onRemove={() => forget(open)}
      >
        {sheet}
      </ProviderPage>
    );

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        Amuse runs on a model you choose, with your own API key.
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
            <ThinkingPicker
              title="Chat"
              levels={models.find((m) => m.id === state.chat)?.thinking ?? []}
              value={state.thinking.chat}
              onChange={(level) => think("chat", level)}
            />
            <ModelPicker
              title="Browser"
              value={state.browser}
              options={models.filter((m) => m.images)}
              onChange={(m) => choose("browser", m)}
            />
            <ThinkingPicker
              title="Browser"
              levels={
                models.find((m) => m.id === state.browser)?.thinking ?? []
              }
              value={state.thinking.browser}
              onChange={(level) => think("browser", level)}
            />
            {/* scheduled work: memory upkeep, reflection, the user's schedules */}
            <ModelPicker
              title="Background"
              value={state.background}
              options={models}
              unset="Same as chat"
              onChange={(m) => choose("background", m)}
            />
            <ThinkingPicker
              title="Background"
              levels={
                models.find((m) => m.id === (state.background ?? state.chat))
                  ?.thinking ?? []
              }
              value={state.thinking.background}
              onChange={(level) => think("background", level)}
            />
          </div>
          <p
            className="mt-2 px-1 text-[13px] leading-snug"
            style={{ color: "var(--text-secondary)" }}
          >
            Background runs your schedules, and keeps memory between
            conversations every hour; a cheaper model does well there.
          </p>
          <p className={label} style={{ color: "var(--text-secondary)" }}>
            Voice
          </p>
          <div
            className={group}
            style={{ background: "var(--fill-secondary)" }}
          >
            <label className="flex items-center gap-3 py-2.5">
              <span
                className="text-[16px]"
                style={{ color: "var(--text-primary)" }}
              >
                Speech to text
              </span>
              <select
                aria-label="Speech to text"
                className="min-w-0 flex-1 truncate bg-transparent text-right text-[15px] outline-none"
                style={{ color: "var(--text-secondary)" }}
                value={state.voice.chosen ?? ""}
                onChange={(e) => voice(e.target.value || null)}
              >
                <option value="">
                  {state.voice.services.length > 0
                    ? "Automatic"
                    : "Needs an OpenAI, Groq or Fireworks key"}
                </option>
                {state.voice.services.map((s) => (
                  <option key={s.provider} value={s.provider}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p
            className="mt-2 px-1 text-[13px] leading-snug"
            style={{ color: "var(--text-secondary)" }}
          >
            Turns what you say into the mic into text. Automatic uses the first
            of OpenAI, Groq and Fireworks you have a key for.
          </p>
          <p className={label} style={{ color: "var(--text-secondary)" }}>
            Your providers
          </p>
          <ul className={group} style={{ background: "var(--fill-secondary)" }}>
            {mine.map((p) => (
              <li key={p.id}>
                <button
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                  onClick={() => onView(p)}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[16px]"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {p.name}
                    </span>
                    <KeyLine hint={p.hint} test={tests[p.id]} brief />
                  </span>
                  <ChevronRight
                    size={16}
                    style={{ color: "var(--icon-secondary)" }}
                  />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={label} style={{ color: "var(--text-secondary)" }}>
        {/* until the list is in, nothing is said about what is set up */}
        {state === null
          ? "Providers"
          : mine.length > 0
            ? "Add a provider"
            : "Choose a provider to start"}
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
        {state === null &&
          [0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="py-3">
              <div className="skeleton h-5 w-2/5 rounded" />
            </li>
          ))}
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
      {sheet}
    </div>
  );
}

/** A provider set up: its key (only the end), what it is used for, and what can be done with it. */
function ProviderPage({
  provider,
  test,
  uses,
  onBack,
  onTest,
  onReplace,
  onRemove,
  children,
}: {
  provider: KeyProvider;
  test: TestState;
  uses: ModelRole[];
  onBack: () => void;
  onTest: () => void;
  onReplace: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const row =
    "hover-fade w-full py-3.5 text-left text-[15px] disabled:opacity-50";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 sm:px-6">
      <button
        aria-label="Back"
        // a desktop's way back to the providers (a phone's is in the settings' own bar)
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
      <div className="mt-2 flex flex-col items-center text-center">
        <span
          className="flex size-12 items-center justify-center rounded-[14px]"
          style={{ background: "#ffffff", color: "#111112" }}
        >
          <KeyRound size={22} />
        </span>
        <p
          className="mt-2 text-[18px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {provider.name}
        </p>
        <p
          className="mt-0.5 text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {uses.length === 0
            ? "Not used for a model now"
            : `Used for ${uses.map((u) => (u === "chat" ? "chat" : "the browser")).join(" and ")}`}
        </p>
      </div>
      <div
        className="mt-5 rounded-[18px] px-4 py-3"
        style={{ background: "var(--fill-secondary)" }}
      >
        <KeyLine hint={provider.hint} test={test} />
      </div>
      <ul
        className={`${group} mt-3`}
        style={{ background: "var(--fill-secondary)" }}
      >
        <li>
          <button
            disabled={test === "testing"}
            className={row}
            style={{ color: "var(--fill-blue)" }}
            onClick={onTest}
          >
            Test key
          </button>
        </li>
        <li>
          <button
            className={row}
            style={{ color: "var(--fill-blue)" }}
            onClick={onReplace}
          >
            Replace key
          </button>
        </li>
        <li>
          <button
            className={row}
            style={{ color: "var(--fill-red)" }}
            onClick={onRemove}
          >
            Remove key
          </button>
        </li>
      </ul>
      {children}
    </div>
  );
}

const levelName: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** How much a role's model thinks; only for a model that can (it takes more than "off"). */
function ThinkingPicker({
  title,
  levels,
  value,
  onChange,
}: {
  title: string;
  levels: ThinkingLevel[];
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
}) {
  if (levels.length < 2) return null;
  return (
    <label className="flex items-center gap-3 py-2.5 pl-4">
      <span className="text-[15px]" style={{ color: "var(--text-secondary)" }}>
        Thinking
      </span>
      <select
        aria-label={`${title} thinking`}
        className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none"
        style={{ color: "var(--text-secondary)" }}
        value={value}
        onChange={(e) => {
          const level = levels.find((l) => l === e.target.value);
          if (level) onChange(level);
        }}
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {levelName[level]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One role's model: the providers' models to choose from (none chosen yet: said so). */
function ModelPicker({
  title,
  value,
  options,
  unset,
  onChange,
}: {
  title: string;
  value: string | null;
  options: KeysState["models"];
  /** what no choice means, where it means something ("Same as chat"); else one must be chosen */
  unset?: string;
  onChange: (model: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-2.5">
      <span className="text-[16px]" style={{ color: "var(--text-primary)" }}>
        {title}
      </span>
      <select
        aria-label={`${title} model`}
        className="min-w-0 flex-1 truncate bg-transparent text-right text-[15px] outline-none"
        style={{
          color: value || unset ? "var(--text-secondary)" : "var(--fill-blue)",
        }}
        value={value ?? ""}
        onChange={(e) =>
          e.target.value ? onChange(e.target.value) : unset && onChange(null)
        }
      >
        {unset ? (
          <option value="">{unset}</option>
        ) : (
          !value && <option value="">Choose a model</option>
        )}
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
