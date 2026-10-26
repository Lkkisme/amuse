/**
 * Cards in the chat feed: one component per non-message entity kind.
 * Props are protocol entities; behavior goes through Actions.
 */
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Globe,
  KeyRound,
  ListTodo,
  ShieldCheck,
} from "lucide-react";
import type {
  Approval,
  Browser,
  Connection,
  Failure,
  KeyProvider,
  Schedule,
  SecretAnswer,
  SecretAsk,
  SecretRequest,
  Session,
  Task,
} from "@amuse/protocol";
import { cardSubtitle, cardSummary, standing } from "../schedules.ts";
import type { Actions } from "../ui.ts";
import { useT } from "../i18n/react.ts";
import { useFail } from "../ask.tsx";
import { Button } from "./Button";
import { type Place, alone, corners } from "./shape.ts";
import { type Draft, type ProviderNames, blank, describeUse, toValue } from "../secrets.ts";
import { AppLogo } from "./AppLogo";
import { ApprovalText } from "./ApprovalText";
import { ValueEditor } from "./SecretFields";
import { KeyLine, KeyLogin, useKeyTests } from "./KeyLogin";
import { useSession } from "../sessionContext.ts";
import { useEffect, useState } from "react";
import {
  bannerActive,
  browserLook,
  hue,
  providerLogo,
  taskStatus,
} from "../view.ts";

const CARD_BG = "var(--fill-secondary)";

/** A card's outer box: Muse's side, its corners set by its place in the feed (shape.ts). */
const shell = (place: Place, className: string, round?: number) => ({
  className,
  style: { background: CARD_BG, ...corners("muse", place, round) },
});

/* ---------- Task ---------- */

export function TaskCard({
  task,
  place = alone,
  actions,
}: {
  task: Task;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  const meta = taskStatus(task.status, t);
  const done = task.steps.filter((s) => s.done).length;
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) p-4")}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{
            background: "var(--fill-primary)",
            color: "var(--icon-primary)",
          }}
        >
          <ListTodo size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className="truncate text-[15px] font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {task.title}
            </p>
            <button
              aria-label={t.cards.openTask}
              className="hover-fade shrink-0 rounded p-0.5"
              style={{ color: "var(--icon-secondary)" }}
              onClick={() => actions.openTaskDetail(task.id)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span
            className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: meta.color }}
          >
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: meta.color }}
            />
            {meta.label}
          </span>
        </div>
      </div>

      {task.steps.length > 0 && (
        <div className="mt-3">
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--fill-tertiary)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(done / task.steps.length) * 100}%`,
                background: "var(--fill-blue)",
              }}
            />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {task.steps.map((step) => (
              <li
                key={step.label}
                className="flex items-center gap-2 text-[13px]"
              >
                {step.done ? (
                  <CircleCheck
                    size={15}
                    style={{ color: "var(--fill-blue)" }}
                    className="shrink-0"
                  />
                ) : (
                  <span
                    className="size-[15px] shrink-0 rounded-full border"
                    style={{ borderColor: "var(--fill-divider)" }}
                  />
                )}
                <span
                  style={{
                    color: step.done
                      ? "var(--text-secondary)"
                      : "var(--text-primary)",
                  }}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- Approval ---------- */

export function ApprovalCard({
  approval,
  place = alone,
  actions,
}: {
  approval: Approval;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  const outcome = {
    approved: { label: t.cards.approved, color: "var(--fill-green)", Icon: CircleCheck },
    denied: { label: t.cards.denied, color: "var(--fill-red)", Icon: CircleAlert },
    timed_out: { label: t.cards.timedOut, color: "var(--icon-secondary)", Icon: CircleAlert },
  };
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) p-4")}>
      <div className="flex items-start gap-3">
        {/* an app's action shows the app, as its Connect card does */}
        {approval.app ? (
          <AppLogo
            name={approval.app}
            logo={providerLogo(approval.app)}
            size={36}
          />
        ) : (
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              background: "var(--fill-primary)",
              color: "var(--icon-primary)",
            }}
          >
            <ShieldCheck size={18} />
          </span>
        )}
        <div className="min-w-0">
          <p
            className="line-clamp-3 text-[15px] font-semibold [overflow-wrap:anywhere]"
            style={{ color: "var(--text-primary)" }}
            title={approval.action}
          >
            {approval.action}
          </p>
          <p
            className="truncate text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {approval.target}
          </p>
        </div>
      </div>
      <ApprovalText detail={approval.detail} />
      {approval.status === "pending" ? (
        <>
          {/* three answers: this once, always (only where a rule can hold it: app actions), or no */}
          {/* one under another: three side by side were cramped on a phone */}
          <div className="mt-3 flex flex-col gap-2">
            <Button
              variant="primary"
              className="w-full"
              onClick={() => actions.resolveApproval(approval.id, "allow_once")}
            >
              {approval.lasting ? t.cards.allow : t.cards.allowOnce}
            </Button>
            {approval.remember && (
              <Button
                tone="accent"
                onCard
                className="w-full"
                onClick={() =>
                  actions.resolveApproval(approval.id, "allow_always")
                }
              >
                {t.cards.alwaysAllow}
              </Button>
            )}
            <Button
              onCard
              className="w-full"
              onClick={() => actions.resolveApproval(approval.id, "deny")}
            >
              {t.cards.deny}
            </Button>
          </div>
        </>
      ) : (
        <Outcome {...outcome[approval.status]} />
      )}
    </div>
  );
}

function Outcome({
  label,
  color,
  Icon,
}: {
  label: string;
  color: string;
  Icon: typeof CircleCheck;
}) {
  return (
    <div
      className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold"
      style={{ background: "var(--fill-card-button)", color }}
    >
      <Icon size={14} />
      {label}
    </div>
  );
}

/* ---------- Connection request ---------- */

/**
 * Muse connection request (ref 52-connreq-desktop): compact card, white tile
 * with the app glyph, name + "Connector", and a neutral Connect pill.
 */
export function ConnectionCard({
  connection,
  place = alone,
  actions,
}: {
  connection: Connection;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  const label = {
    pending: t.cards.connect,
    connected: t.cards.connected,
    dismissed: t.cards.notNow,
  }[connection.status];
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) p-2.5", 18)}>
      <div className="flex items-center gap-2.5 px-0.5 pt-0.5">
        <AppLogo
          name={connection.title}
          logo={providerLogo(connection.provider)}
          size={40}
        />
        <div className="min-w-0">
          <p
            className="truncate text-[14px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {connection.title}
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {t.cards.connection}
          </p>
        </div>
      </div>
      {connection.status === "pending" ? (
        <Button
          onCard
          className="mt-2.5 w-full"
          onClick={() => actions.openExplainer(connection.id)}
        >
          {label}
        </Button>
      ) : (
        <p
          className="mt-2.5 inline-flex items-center gap-1.5 text-[14px] font-medium"
          style={{
            color:
              connection.status === "connected"
                ? "var(--fill-green)"
                : "var(--text-secondary)",
          }}
        >
          {connection.status === "connected" && <Check size={15} />}
          {label}
        </p>
      )}
    </div>
  );
}

/* ---------- Credential ---------- */

/** What a card for a secret can have said of a use of the server's, which it does not know the provider's name for. */
const NO_NAMES: ProviderNames = new Map();

/**
 * Amuse asking for a secret: a code a program waits for (typed here, it goes into that terminal and is kept nowhere),
 * or a long-term one (kept in the Vault, with the uses the card says; filling it in is the user's word for
 * them). Either way it goes through the server, never into the chat or Amuse's context.
 */
export function SecretCard({
  secret,
  place = alone,
  actions,
}: {
  secret: SecretRequest;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const failed = useFail();
  /** `cleared`: what to forget of what was typed, once it is given */
  const answer = (given: SecretAnswer | null, cleared: () => void) => {
    setBusy(true);
    actions
      .answerSecret(secret.id, given)
      .then(cleared, (e: unknown) => failed(e, "Secret request › answer", () => answer(given, cleared)))
      .finally(() => setBusy(false));
  };
  const { deliver } = secret;
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) p-3", 18)}>
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            background: "var(--fill-card-button)",
            color: "var(--icon-primary)",
          }}
        >
          <KeyRound size={18} />
        </span>
        <div className="min-w-0">
          <p
            className="truncate text-[14px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {secret.name}
          </p>
          <p
            className="truncate text-[12px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {deliver.kind === "temporary"
              ? t.cards.destinationPane(deliver.pane)
              : deliver.kind === "key"
                ? t.cards.keySub
                : t.cards.storedSub}
          </p>
        </div>
      </div>
      {secret.why && (
        <p
          className="mt-2 text-[14px]"
          style={{ color: "var(--text-primary)" }}
        >
          {secret.why}
        </p>
      )}
      {deliver.kind === "key" ? (
        <KeyForm
          provider={deliver.provider}
          hint={deliver.hint}
          status={secret.status}
          busy={busy}
          onNotNow={() => answer(null, () => undefined)}
        />
      ) : secret.status === "pending" ? (
        deliver.kind === "temporary" ? (
          <OneTimeForm label={secret.name} busy={busy} answer={answer} />
        ) : (
          <StoredForm ask={deliver} busy={busy} answer={answer} />
        )
      ) : (
        <SecretOutcome status={secret.status} added={deliver.kind === "stored" ? t.cards.savedToVault : t.cards.provided} notAdded={t.cards.declined} />
      )}
    </div>
  );
}

/**
 * Amuse asking for the key of a service of the server's: the sign-in sheet is Settings' own. The server settles the
 * card as soon as the key is there, whoever added it, so this only offers the sheet, tries the key it adds, and says
 * how it stands.
 */
function KeyForm(props: KeyFormProps) {
  const session = useSession();
  return session ? <KeyFormOn session={session} {...props} /> : null;
}

interface KeyFormProps {
  provider: string;
  hint: string | null;
  status: SecretRequest["status"];
  busy: boolean;
  onNotNow: () => void;
}

function KeyFormOn({
  session,
  provider,
  hint,
  status,
  busy,
  onNotNow,
}: KeyFormProps & { session: Session }) {
  const t = useT();
  const [setting, setSetting] = useState<KeyProvider | null>(null);
  const failed = useFail();
  const { tests, test } = useKeyTests(session);
  const open = () => {
    void session.call("keys.list", {}).then(
      ({ providers }) => {
        const found = providers.find((p) => p.id === provider);
        if (found) setSetting(found);
        else failed(new Error(t.cards.keyUnknown), "Secret request › find the provider", undefined);
      },
      (e: unknown) => failed(e, "Secret request › list providers", open),
    );
  };
  const tried = tests[provider];
  return (
    <>
      {status !== "declined" && (hint || tried !== undefined) && (
        <div className="mt-2">
          <KeyLine hint={hint} test={tried} />
        </div>
      )}
      {status === "pending" ? (
        <div className="mt-2.5 flex gap-2">
          <Button onCard className="flex-1" disabled={busy} onClick={onNotNow}>
            {t.cards.notNow}
          </Button>
          <Button variant="primary" className="flex-1" disabled={busy} onClick={open}>
            {t.cards.addKey}
          </Button>
        </div>
      ) : (
        <SecretOutcome status={status} added={t.cards.keyAdded} notAdded={t.cards.keyNotAdded} />
      )}
      <KeyLogin
        session={session}
        provider={setting}
        onClose={(done) => {
          // a key just set up is tried at once, as in Settings
          if (done && setting) test(setting.id);
          setSetting(null);
        }}
      />
    </>
  );
}

/** How a card for a secret ended. */
function SecretOutcome({ status, added, notAdded }: { status: SecretRequest["status"]; added: string; notAdded: string }) {
  return (
    <p
      className="mt-2.5 inline-flex items-center gap-1.5 text-[14px] font-medium"
      style={{ color: status === "provided" ? "var(--fill-green)" : "var(--text-secondary)" }}
    >
      {status === "provided" && <Check size={15} />}
      {status === "provided" ? added : notAdded}
    </p>
  );
}

/** What a form on a secret's card hands the card to send: the answer (null: declined), and what to forget once it is sent. */
type Answer = (given: SecretAnswer | null, cleared: () => void) => void;

/** Decline / Provide (Provide once there is something to provide). */
function AnswerButtons({
  busy,
  ready,
  provide,
  onDecline,
  onProvide,
}: {
  busy: boolean;
  ready: boolean;
  /** what the button that gives it says */
  provide: string;
  onDecline: () => void;
  onProvide: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="mt-2.5 flex gap-2">
        <Button onCard className="flex-1" disabled={busy} onClick={onDecline}>
          {t.cards.decline}
        </Button>
        <Button variant="primary" className="flex-1" disabled={busy || !ready} onClick={onProvide}>
          {provide}
        </Button>
      </div>
    </>
  );
}

/** A code for a program that waits for it: one line, used once. */
function OneTimeForm({
  label,
  busy,
  answer,
}: {
  label: string;
  busy: boolean;
  answer: Answer;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const provide = () => answer({ kind: "temporary", value }, () => setValue(""));
  return (
    <>
      <input
        type="password"
        autoComplete="off"
        aria-label={label}
        placeholder={t.cards.secretPlaceholder}
        className="mt-2.5 h-10 w-full rounded-[12px] px-3 text-[14px] outline-none"
        style={{ background: "var(--field)", color: "var(--text-primary)" }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value && !busy && provide()}
      />
      <p
        className="mt-1.5 text-[12px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {t.cards.oneTime}
      </p>
      <AnswerButtons
        busy={busy}
        ready={value !== ""}
        provide={t.cards.provide}
        onDecline={() => answer(null, () => setValue(""))}
        onProvide={provide}
      />
    </>
  );
}

/**
 * A long-term secret: the plain fields Amuse filled in (read-only, said to be visible to it), an input for each secret field the user types
 * (everything typed on a card is secret), Amuse's note, and what it sets up.
 */
function StoredForm({
  ask,
  busy,
  answer,
}: {
  ask: Extract<SecretAsk, { kind: "stored" }>;
  busy: boolean;
  answer: Answer;
}) {
  const t = useT();
  const [secret, setSecret] = useState<Draft[]>(() => ask.secret.map((f) => blank(f.kind)));
  /** the values given, in order; as many as there are fields only when every one is filled in */
  const secretValues = ask.secret.flatMap((field, i) => {
    const draft = secret[i];
    const value = draft ? toValue(draft, field.name) : null;
    return value ? [{ name: field.name, value }] : [];
  });
  const ready = secretValues.length === ask.secret.length;
  const change = (i: number, draft: Draft) => setSecret((drafts) => drafts.map((d, j) => (j === i ? draft : d)));
  const forget = () => setSecret(ask.secret.map((f) => blank(f.kind)));
  return (
    <>
      {ask.plain.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {t.cards.plainNote}
          </p>
          {ask.plain.map((f) => (
            <p key={f.name} className="text-[13px] [overflow-wrap:anywhere]" style={{ color: "var(--text-primary)" }}>
              <span style={{ color: "var(--text-secondary)" }}>{f.name}: </span>
              {f.value.kind === "text" ? f.value.text : f.value.filename}
            </p>
          ))}
        </div>
      )}
      {ask.secret.map((f, i) => (
        <div key={f.name} className="mt-2.5">
          <p className="mb-1 text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {f.name}
          </p>
          {secret[i] && <ValueEditor draft={secret[i]} onChange={(draft) => change(i, draft)} secret fallbackName={f.name} look="card" label={f.name} />}
        </div>
      ))}
      {ask.note && (
        <p className="mt-2.5 text-[13px] [overflow-wrap:anywhere]" style={{ color: "var(--text-secondary)" }}>
          <span className="font-medium">{t.cards.noteLabel}: </span>
          {ask.note}
        </p>
      )}
      {ask.uses.length > 0 && (
        <p className="mt-2 text-[13px] [overflow-wrap:anywhere]" style={{ color: "var(--text-secondary)" }}>
          {t.cards.setsUp(ask.uses.map((use) => describeUse(use, NO_NAMES, t)).join(", "))}
        </p>
      )}
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
        {t.cards.storedNote}
      </p>
      <AnswerButtons
        busy={busy}
        ready={ready}
        provide={t.cards.saveToVault}
        onDecline={() => answer(null, forget)}
        onProvide={() => answer({ kind: "stored", secret: secretValues }, forget)}
      />
    </>
  );
}

/* ---------- Failure ---------- */

/** Muse could not reply: a notice of its own (not Muse's words), with the provider's words and a way to try again. */
export function FailureCard({
  failure,
  place = alone,
  actions,
}: {
  failure: Failure;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) px-4 py-3", 18)} role="status">
      <div className="flex items-start gap-2.5">
        <CircleAlert
          size={18}
          className="mt-0.5 shrink-0"
          style={{ color: "var(--fill-orange)" }}
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-[14px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t.cards.couldntReply}
          </p>
          <p
            className="mt-0.5 text-[13px] leading-snug"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.cards.failedReason[failure.reason]}
          </p>
          <details className="mt-1">
            <summary
              className="cursor-pointer text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {t.cards.details}
            </summary>
            <p
              className="mt-1 break-words text-[12px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {failure.detail}
            </p>
          </details>
        </div>
      </div>
      {failure.status === "open" ? (
        <Button
          onCard
          className="mt-2.5 w-full"
          onClick={() => actions.retry(failure.id)}
        >
          {t.cards.tryAgain}
        </Button>
      ) : (
        <p
          className="mt-2 text-[12px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t.cards.triedAgain}
        </p>
      )}
    </div>
  );
}

/* ---------- Schedule ---------- */

/** A light calendar tile (a header band and a grid of days) with a small amber clock badge, light in both themes like an app's icon; grey once the schedule is over. */
function ScheduleIcon({ over }: { over: boolean }) {
  const days = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ x: 11 + col * 7, y: 17 + row * 6 })));
  const badge = over ? "#9aa0a6" : "#f5b301";
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <rect x="2" y="2" width="32" height="32" rx="9" fill="#fff" stroke="#d9dce1" />
      <path d="M2 11a9 9 0 0 1 9-9h14a9 9 0 0 1 9 9v2H2z" fill="#eceef1" />
      {days.map((d) => (
        <circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r="1.7" fill="#8b919a" />
      ))}
      <circle cx="31" cy="31" r="8" fill={badge} stroke="#fff" strokeWidth="2" />
      <path d="M31 26.5V31l3 1.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Work the agent set up for later: one card for it, kept up to date as it is paused, resumed, done or cancelled; managed in Settings › Schedules. */
export function ScheduleCard({
  schedule,
  place = alone,
  actions,
}: {
  schedule: Schedule;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  const over = !standing(schedule);
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) p-4")}>
      <div className="flex items-start gap-3">
        <ScheduleIcon over={over} />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[15px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {schedule.title}
          </p>
          <p
            className="text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {cardSubtitle(schedule)}
          </p>
        </div>
      </div>
      <p
        className="mt-3 line-clamp-3 text-[14px] leading-[20px]"
        style={{ color: "var(--text-primary)" }}
      >
        {cardSummary(schedule)}
      </p>
      {!over && (
        <Button
          onCard
          className="mt-3 w-full"
          onClick={() => actions.openSettings("schedules")}
        >
          {t.cards.viewScheduledTask}
        </Button>
      )}
    </div>
  );
}

/* ---------- Browser run ---------- */

/** A sketch of a page, for the demo or when the real page is gone. */
function Sketch({ id }: { id: string }) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div
        className="h-2.5 w-1/3 rounded-sm"
        style={{ background: `hsl(${hue(id)} 40% 80%)` }}
      />
      <div
        className="h-2 w-1/2 rounded-sm"
        style={{ background: "var(--fill-tertiary)" }}
      />
      <div
        className="h-2 w-2/5 rounded-sm"
        style={{ background: "var(--fill-tertiary)" }}
      />
    </div>
  );
}

/**
 * The real page, refreshed every few seconds while the run is in flight.
 * Until a frame loads (the page may not be open yet) the sketch shows; every
 * refresh tries again.
 */
function Thumbnail({
  src,
  live,
  id,
}: {
  src: string;
  live: boolean;
  id: string;
}) {
  const [tick, setTick] = useState(0);
  /** loading: the first screenshot is on its way; missing: none to be had, so a sketch stands in */
  const [shot, setShot] = useState<"loading" | "shown" | "missing">("loading");
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, [live]);
  return (
    <div className="relative h-full w-full">
      {shot === "loading" && <div className="skeleton absolute inset-0" />}
      {shot === "missing" && <Sketch id={id} />}
      <img
        alt=""
        src={`${src}&t=${tick}`}
        className="absolute inset-0 h-full w-full object-cover object-top"
        style={{ visibility: shot === "shown" ? "visible" : "hidden" }}
        onError={() => setShot("missing")} // the next refresh tries again
        onLoad={() => setShot("shown")}
      />
    </div>
  );
}

/** A browser's page, small: the real one where a server has it (kept fresh while `live`), else a sketch. */
export function PagePreview({
  id,
  thumb,
  live,
}: {
  id: string;
  thumb: ((id: string) => string) | null;
  live: boolean;
}) {
  return thumb ? (
    <Thumbnail src={thumb(id)} live={live} id={id} />
  ) : (
    <Sketch id={id} />
  );
}

/**
 * A run whose browser is gone: only a record of it. No page, nothing to open
 * (a button there would lead nowhere).
 */
function EndedBrowserCard({
  browser,
  place,
}: {
  browser: Browser;
  place: Place;
}) {
  const t = useT();
  return (
    <div {...shell(place, "flex w-full max-w-(--amuse-width) items-center gap-3 p-4")}>
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
        style={{
          background: "var(--fill-primary)",
          color: "var(--icon-secondary)",
        }}
      >
        <Globe size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="text-[14px] font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {t.cards.browser}
        </p>
        <p
          className="truncate text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {browserLook(browser, t).label} · {browser.title}
        </p>
      </div>
    </div>
  );
}

/**
 * Muse browser card: tinted globe tile + "Browser" + "<status> · <task>", a
 * page thumbnail, and one pill button. Refs 06-card-desktop, 02-run-*, 08-now.
 */
export function BrowserCard({
  browser,
  thumb,
  place = alone,
  actions,
}: {
  browser: Browser;
  thumb: ((id: string) => string) | null;
  place?: Place;
  actions: Actions;
}) {
  const t = useT();
  const meta = browserLook(browser, t);
  const open = () => actions.openViewer(browser.id);
  if (!browser.live)
    return <EndedBrowserCard browser={browser} place={place} />;
  return (
    <div {...shell(place, "w-full max-w-(--amuse-width) p-4")}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            background: `color-mix(in srgb, ${meta.color} 12%, var(--fill-primary))`,
            color: meta.color,
          }}
        >
          <Globe size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[14px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {t.cards.browser}
          </p>
          <p
            className="truncate text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {meta.label} · {browser.title}
          </p>
        </div>
      </div>

      <button
        aria-label={t.cards.openViewer}
        className="mt-3 block h-[178px] w-full overflow-hidden rounded-[10px] text-left"
        style={{
          background: "var(--fill-primary)",
          border: "1px solid var(--fill-divider)",
        }}
        onClick={open}
      >
        {thumb ? (
          <Thumbnail
            src={thumb(browser.id)}
            live={bannerActive(browser)}
            id={browser.id}
          />
        ) : (
          <Sketch id={browser.id} />
        )}
      </button>

      <Button onCard className="mt-3 w-full" onClick={open}>
        {t.cards.openBrowser}
      </Button>
    </div>
  );
}
