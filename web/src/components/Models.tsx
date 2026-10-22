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
import { Sheet } from "./Sheet";
import { useT } from "../i18n/react.ts";

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
  const t = useT();
  const [state, setState] = useState<KeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState<KeyProvider | null>(null);
  const { tests, test, clear } = useKeyTests(session);
  const [query, setQuery] = useState("");
  const [ownVoice, setOwnVoice] = useState(false);

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
  /** a provider's name by its id, for the pickers */
  const names = new Map(providers.map((p) => [p.id, p.name]));
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
        {t.models.intro}
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
            {t.models.models}
          </p>
          <div
            className={group}
            style={{ background: "var(--fill-secondary)" }}
          >
            <ModelPicker
              title={t.models.chat}
              value={state.chat}
              options={models}
              names={names}
              onChange={(m) => choose("chat", m)}
            />
            <ThinkingPicker
              title={t.models.chat}
              levels={models.find((m) => m.id === state.chat)?.thinking ?? []}
              value={state.thinking.chat}
              onChange={(level) => think("chat", level)}
            />
            <ModelPicker
              title={t.models.browser}
              value={state.browser}
              options={models.filter((m) => m.images)}
              names={names}
              onChange={(m) => choose("browser", m)}
            />
            <ThinkingPicker
              title={t.models.browser}
              levels={
                models.find((m) => m.id === state.browser)?.thinking ?? []
              }
              value={state.thinking.browser}
              onChange={(level) => think("browser", level)}
            />
            {/* scheduled work: memory upkeep, reflection, the user's schedules */}
            <ModelPicker
              title={t.models.background}
              value={state.background}
              options={models}
              names={names}
              unset={t.models.sameAsChat}
              onChange={(m) => choose("background", m)}
            />
            <ThinkingPicker
              title={t.models.background}
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
            {t.models.backgroundHelp}
          </p>
          <p className={label} style={{ color: "var(--text-secondary)" }}>
            {t.models.voice}
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
                {t.models.speechToText}
              </span>
              <select
                aria-label={t.models.speechToText}
                className="min-w-0 flex-1 truncate bg-transparent text-right text-[15px] outline-none"
                style={{ color: "var(--text-secondary)" }}
                value={state.voice.chosen ?? ""}
                onChange={(e) => voice(e.target.value || null)}
              >
                <option value="">
                  {state.voice.services.length > 0
                    ? t.models.automatic
                    : t.models.needsKey}
                </option>
                {state.voice.services.map((s) => (
                  <option key={s.provider} value={s.provider}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="flex w-full items-center gap-3 py-2.5 text-left"
              onClick={() => setOwnVoice(true)}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block text-[16px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t.models.ownServer}
                </span>
                <span
                  className="block truncate text-[13px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {state.voice.local
                    ? `${state.voice.local.model} · ${state.voice.local.url}`
                    : t.models.notSet}
                </span>
              </span>
              <ChevronRight
                size={16}
                style={{ color: "var(--icon-secondary)" }}
              />
            </button>
          </div>
          <LocalVoiceSheet
            open={ownVoice}
            current={state.voice.local}
            onClose={() => setOwnVoice(false)}
            onSave={(service) => {
              setError(null);
              return session.call("models.localVoice", { service }).then(
                () => {
                  setOwnVoice(false);
                  void load();
                },
                (e: unknown) => {
                  throw e instanceof Error ? e : new Error(String(e));
                },
              );
            }}
          />
          <p
            className="mt-2 px-1 text-[13px] leading-snug"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.models.voiceHelp}
          </p>
          <p className={label} style={{ color: "var(--text-secondary)" }}>
            {t.models.yourProviders}
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
          ? t.models.providers
          : mine.length > 0
            ? t.models.addProvider
            : t.models.chooseToStart}
      </p>
      <label
        className="mb-2 flex items-center gap-2 rounded-full px-4 py-2.5"
        style={{ background: "var(--field)" }}
      >
        <Search size={16} style={{ color: "var(--icon-secondary)" }} />
        <input
          aria-label={t.models.searchProviders}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder={t.models.searchProviders}
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
            {t.models.noProvider}
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
  const t = useT();
  const row =
    "hover-fade w-full py-3.5 text-left text-[15px] disabled:opacity-50";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 sm:px-6">
      <button
        aria-label={t.common.back}
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
            ? t.models.notUsed
            : t.models.usedFor(uses.map((u) => (u === "chat" ? t.models.useChat : t.models.useBrowser)))}
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
            {t.keys.testKey}
          </button>
        </li>
        <li>
          <button
            className={row}
            style={{ color: "var(--fill-blue)" }}
            onClick={onReplace}
          >
            {t.keys.replaceKey}
          </button>
        </li>
        <li>
          <button
            className={row}
            style={{ color: "var(--fill-red)" }}
            onClick={onRemove}
          >
            {t.keys.removeKey}
          </button>
        </li>
      </ul>
      {children}
    </div>
  );
}

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
  const t = useT();
  if (levels.length < 2) return null;
  return (
    <label className="flex items-center gap-3 py-2.5 pl-4">
      <span className="text-[15px]" style={{ color: "var(--text-secondary)" }}>
        {t.models.thinking}
      </span>
      <select
        aria-label={t.models.thinkingFor(title)}
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
            {t.models.levels[level]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The user's own speech server: an OpenAI-style /audio/transcriptions (faster-whisper-server,
 * whisper.cpp's server, LocalAI…), by its address, the model it serves, and a key if it wants one.
 */
function LocalVoiceSheet({
  open,
  current,
  onClose,
  onSave,
}: {
  open: boolean;
  current: { url: string; model: string } | null;
  onClose: () => void;
  onSave: (
    service: { url: string; model: string; key: string | null } | null,
  ) => Promise<void>;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUrl(current?.url ?? "http://host.docker.internal:8000/v1");
    setModel(current?.model ?? "");
    setKey("");
    setProblem(null);
  }, [open, current]);
  const save = (
    service: { url: string; model: string; key: string | null } | null,
  ) =>
    onSave(service).catch((e: unknown) =>
      setProblem(e instanceof Error ? e.message : String(e)),
    );
  const field = "w-full bg-transparent px-4 py-3.5 text-[16px] outline-none";
  return (
    <Sheet open={open} onClose={onClose} bare>
      <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
        <p
          className="text-[20px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {t.models.localTitle}
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.models.localHelp}
        </p>
        <div
          className="mt-5 w-full divide-y divide-[var(--fill-divider)] overflow-hidden rounded-[18px] text-left"
          style={{ background: "var(--field)" }}
        >
          <input
            aria-label={t.models.address}
            className={field}
            style={{ color: "var(--text-primary)" }}
            placeholder="http://host.docker.internal:8000/v1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            aria-label={t.models.modelName}
            className={field}
            style={{ color: "var(--text-primary)" }}
            placeholder={t.models.modelPlaceholder}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <input
            aria-label={t.models.keyLabel}
            type="password"
            autoComplete="off"
            className={field}
            style={{ color: "var(--text-primary)" }}
            placeholder={current ? t.models.keyKeepNone : t.models.keyIfNeeded}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        {problem && (
          <p
            role="alert"
            className="mt-2 text-[13px]"
            style={{ color: "var(--fill-red)" }}
          >
            {problem}
          </p>
        )}
        <button
          disabled={!url.trim() || !model.trim()}
          className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--fill-blue)" }}
          onClick={() =>
            void save({
              url: url.trim(),
              model: model.trim(),
              key: key.trim() || null,
            })
          }
        >
          {t.models.save}
        </button>
        {current && (
          <button
            className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
            style={{ color: "var(--fill-red)" }}
            onClick={() => void save(null)}
          >
            {t.common.remove}
          </button>
        )}
        <button
          className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
          style={{ color: "var(--text-primary)" }}
          onClick={onClose}
        >
          {t.common.cancel}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * One role's model: first its provider (when more than one has models: the same model can be at two), then one of
 * that provider's models. None chosen yet: said so. A provider picked shows its models; the role's model changes only
 * once one of them is picked.
 */
function ModelPicker({
  title,
  value,
  options,
  names,
  unset,
  onChange,
}: {
  title: string;
  value: string | null;
  options: KeysState["models"];
  /** a provider's name by its id */
  names: ReadonlyMap<string, string>;
  /** what no choice means, where it means something ("Same as chat"); else one must be chosen */
  unset?: string;
  onChange: (model: string | null) => void;
}) {
  const t = useT();
  const providers = [...new Set(options.map((o) => o.provider))];
  const current = options.find((o) => o.id === value)?.provider ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const provider = picked ?? current ?? providers[0] ?? null;
  const shown = options.filter((o) => o.provider === provider);
  // the role's model is this provider's: it is the one shown chosen; else, until one is picked, nothing is
  const chosen = value !== null && shown.some((o) => o.id === value) ? value : "";
  const select = "min-w-0 truncate bg-transparent text-right text-[15px] outline-none [text-align-last:right]";
  return (
    // in columns, so the rows' pickers line up: the role's name, its provider (when there is a choice), its model
    <div
      className={`grid items-center gap-3 py-2.5 ${providers.length > 1 ? "grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1.3fr)] sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.6fr)]" : "grid-cols-[auto_minmax(0,1fr)]"}`}
    >
      <span className="truncate text-[16px]" style={{ color: "var(--text-primary)" }}>
        {title}
      </span>
      {providers.length > 1 && (
        <select
          aria-label={t.models.providerFor(title)}
          className={`${select} w-full`}
          style={{ color: "var(--text-secondary)" }}
          value={provider ?? ""}
          onChange={(e) => setPicked(e.target.value)}
        >
          {providers.map((id) => (
            <option key={id} value={id}>
              {names.get(id) ?? id}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label={t.models.modelFor(title)}
        className={`${select} w-full`}
        style={{
          color: chosen || (unset && value === null) ? "var(--text-secondary)" : "var(--fill-blue)",
        }}
        value={chosen}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
          else if (unset) onChange(null);
        }}
      >
        {unset ? <option value="">{unset}</option> : !chosen && <option value="">{t.models.chooseModel}</option>}
        {value && !options.some((o) => o.id === value) && <option value={value}>{value}</option>}
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
