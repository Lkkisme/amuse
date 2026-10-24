/**
 * Setting up a provider: the provider's own sign-in, a step at a time as the
 * server relays it, in a sheet from the bottom on a phone and a dialog on a
 * desktop. A provider that also takes a sign-in with the user's account asks
 * first which way. With a key: where to get one (the provider's guide), then
 * its prompts (the key, sometimes an account id or a region). With an
 * account: the provider's page to open, then the code it shows or the address
 * of the page it ends on pasted back, or a code to enter there while the sheet
 * waits. What is pasted goes to the server, and no key or token comes back.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import type {
  KeyGuide,
  KeyProvider,
  KeyTest,
  KeyWay,
  LoginStep,
  Session,
} from "@amuse/protocol";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { useT } from "../i18n/react.ts";

/** How long to rest before asking again when the connection dropped while waiting. */
const RETRY_MS = 2000;

const secondary = { color: "var(--text-secondary)" };
const link = { color: "var(--fill-blue)" };

/** The host of a URL, as a person names the site. */
const site = (url: string) => new URL(url).host;

export function KeyLogin({
  session,
  provider,
  onClose,
}: {
  session: Session;
  /** the provider being set up; null: closed */
  provider: KeyProvider | null;
  /** `done`: a key was set up, or the user signed in */
  onClose: (done: boolean) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<LoginStep | null>(null);
  // null: the way is still to be chosen
  const [way, setWay] = useState<KeyWay | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // an answer on its way: what keys.wait hears meanwhile is the answer's to tell
  const answering = useRef(false);
  // the provider shown while the sheet closes
  const [shown, setShown] = useState<KeyProvider | null>(provider);

  const settle = (next: Promise<LoginStep>) => {
    setBusy(true);
    answering.current = true;
    next.then(
      (s) => {
        answering.current = false;
        setBusy(false);
        setValue("");
        if (s.kind === "done") return onClose(true);
        setStep(s);
      },
      (e: unknown) => {
        answering.current = false;
        setBusy(false);
        setStep({
          kind: "failed",
          reason: e instanceof Error ? e.message : String(e),
        });
      },
    );
  };
  const start = (id: string, chosen: KeyWay) => {
    setWay(chosen);
    setStep(null);
    settle(session.call("keys.login", { provider: id, way: chosen }));
  };
  useEffect(() => {
    if (!provider) return;
    setShown(provider);
    setStep(null);
    setValue("");
    setWay(null);
    // only a model provider that offers a sign-in asks which way
    if (!provider.account) start(provider.id, "key");
    // a new sign-in for each provider opened
  }, [provider]);

  // while the user is on the provider's page, the next step comes by itself
  useEffect(() => {
    const waiting =
      step?.kind === "prompt" || step?.kind === "wait" ? step : null;
    if (
      !waiting ||
      (waiting.kind === "prompt" &&
        waiting.prompt.type !== "code" &&
        waiting.prompt.type !== "address")
    )
      return;
    let live = true;
    const login = waiting.login;
    const same = JSON.stringify(step);
    void (async () => {
      while (live) {
        const next = await session
          .call("keys.wait", { login })
          .catch(() => null);
        if (!live || answering.current) return;
        if (next === null) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
          continue;
        }
        if (JSON.stringify(next) === same) continue;
        if (next.kind === "done") return onClose(true);
        setValue("");
        return setStep(next);
      }
    })();
    return () => {
      live = false;
    };
  }, [step]);

  const cancel = () => {
    if (step?.kind === "prompt" || step?.kind === "wait")
      void session.call("keys.cancel", { login: step.login }).catch(() => {});
    onClose(false);
  };
  const answer = (given: string) => {
    if (step?.kind !== "prompt" || busy) return;
    settle(session.call("keys.answer", { login: step.login, value: given }));
  };

  const prompt = step?.kind === "prompt" ? step.prompt : null;
  const live = step?.kind === "prompt" || step?.kind === "wait" ? step : null;
  const account = shown?.account ?? null;
  const risk = account?.subscription ? (
    <Risk claude={shown?.id === "anthropic"} />
  ) : null;
  return (
    <Sheet open={provider !== null} onClose={cancel} bare>
      <div className="flex flex-col items-center overflow-y-auto px-6 pb-6 pt-5 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-[16px]"
          style={{ background: "#ffffff", color: "#111112" }}
        >
          <KeyRound size={26} />
        </span>
        <p
          className="mt-4 text-[20px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {shown?.name}
        </p>
        <p className="mt-1 text-[14px]" style={secondary}>
          {way === null
            ? t.keys.chooseWay
            : way === "account"
              ? t.keys.useAccount
              : shown?.connected
                ? t.keys.replace
                : t.keys.add}
        </p>

        {way === null && account && shown && (
          <ul
            className="mt-5 w-full divide-y divide-[var(--fill-divider)] overflow-hidden rounded-[18px] text-left"
            style={{ background: "var(--field)" }}
          >
            <li>
              <button
                className="w-full px-4 py-3 text-left"
                onClick={() => start(shown.id, "key")}
              >
                <span
                  className="block text-[16px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t.keys.useKey}
                </span>
                <span className="block text-[13px]" style={secondary}>
                  {t.keys.useKeyHelp}
                </span>
              </button>
            </li>
            <li>
              <button
                className="w-full px-4 py-3 text-left"
                onClick={() => start(shown.id, "account")}
              >
                <span
                  className="block text-[16px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t.keys.useAccount}
                </span>
                <span className="block text-[13px]" style={secondary}>
                  {account.name}
                </span>
              </button>
            </li>
          </ul>
        )}
        {way === null && risk}

        {way === "key" && shown?.use === "models" && shown.guide && (
          <Guide guide={shown.guide} />
        )}
        {way === "account" && risk}

        {live?.notes.map((note, i) => (
          <p key={i} className="mt-3 text-[14px]" style={secondary}>
            {note.message}{" "}
            {note.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={link}
              >
                {l.label ?? l.url}
              </a>
            ))}
          </p>
        ))}

        {live && (live.page || live.device) && (
          <SignInSteps step={live} prompt={prompt?.type ?? null} />
        )}

        {prompt && prompt.type !== "select" && (
          <form
            className="mt-5 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              // a text prompt may be left empty (GitHub Enterprise's domain: empty for github.com)
              if (value.trim() || prompt.type === "text") answer(value);
            }}
          >
            <p
              className="mb-2 text-left text-[13px] font-medium"
              style={secondary}
            >
              {prompt.type === "address"
                ? t.keys.address
                : prompt.type === "code"
                  ? t.keys.code
                  : prompt.message}
            </p>
            <input
              autoFocus
              aria-label={
                prompt.type === "address"
                  ? t.keys.address
                  : prompt.type === "code"
                    ? t.keys.code
                    : prompt.message
              }
              type={prompt.type === "secret" ? "password" : "text"}
              inputMode={prompt.type === "address" ? "url" : undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full rounded-[18px] px-4 py-3.5 text-[16px] outline-none"
              style={{
                background: "var(--field)",
                color: "var(--text-primary)",
              }}
              placeholder={
                prompt.type === "address" && prompt.placeholder
                  ? `${prompt.placeholder}?code=…`
                  : (prompt.placeholder ?? "")
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              variant="primary"
              size="lg"
              className="mt-6"
              type="submit"
              disabled={(!value.trim() && prompt.type !== "text") || busy}
            >
              {t.common.continue}
            </Button>
          </form>
        )}

        {prompt?.type === "select" && (
          <div className="mt-5 w-full text-left">
            <p className="mb-2 text-[13px] font-medium" style={secondary}>
              {prompt.message}
            </p>
            <ul
              className="divide-y divide-[var(--fill-divider)] overflow-hidden rounded-[18px]"
              style={{ background: "var(--field)" }}
            >
              {prompt.options.map((option) => (
                <li key={option.id}>
                  <button
                    disabled={busy}
                    className="w-full px-4 py-3 text-left"
                    onClick={() => answer(option.id)}
                  >
                    <span
                      className="block text-[16px]"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block text-[13px]" style={secondary}>
                        {option.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {way !== null && step === null && (
          <div className="skeleton mt-5 h-12 w-full rounded-[18px]" />
        )}

        {step?.kind === "failed" && (
          <>
            <p
              role="alert"
              className="mt-5 text-[14px]"
              style={{ color: "var(--fill-red)" }}
            >
              {step.reason}
            </p>
            <Button
              variant="primary"
              size="lg"
              className="mt-6"
              onClick={() => shown && start(shown.id, way ?? "key")}
            >
              {t.keys.tryAgain}
            </Button>
          </>
        )}

        <Button variant="plain" size="lg" className="mt-2" onClick={cancel}>
          {t.common.cancel}
        </Button>
      </div>
    </Sheet>
  );
}

/** What signing in with a subscription risks, said beside the way in. */
function Risk({ claude }: { claude: boolean }) {
  const t = useT();
  return (
    <p
      className="mt-3 rounded-[14px] px-3.5 py-2.5 text-left text-[13px] leading-snug"
      style={{ background: "var(--fill-secondary)", color: "var(--text-secondary)" }}
    >
      {claude ? `${t.keys.claudeRisk} ` : ""}
      {t.keys.subscriptionRisk}
    </p>
  );
}

/** Numbered steps, in a card. */
function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol
      className="mt-5 w-full list-decimal space-y-2 rounded-[18px] py-3.5 pl-9 pr-4 text-left text-[14px] leading-snug"
      style={{ background: "var(--fill-secondary)", color: "var(--text-primary)" }}
    >
      {children.map((child, i) => (
        <li key={i}>{child}</li>
      ))}
    </ol>
  );
}

/** Where to get a provider's key: the same three steps for every one, its links, and what more it takes. */
function Guide({ guide }: { guide: KeyGuide }) {
  const t = useT();
  const to = (url: string, text: string) => (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
      style={link}
    >
      {text}
    </a>
  );
  return (
    <>
      <Steps>
        {[
          to(guide.home, t.keys.guide.signIn(site(guide.home))),
          to(guide.keys, t.keys.guide.keysPage),
          t.keys.guide.paste,
        ]}
      </Steps>
      {(guide.note || guide.docs) && (
        <p className="mt-3 text-left text-[13px] leading-snug" style={secondary}>
          {guide.note ? `${t.keys.guide.notes[guide.note]} ` : ""}
          {guide.docs && to(guide.docs, t.keys.guide.setupGuide)}
        </p>
      )}
    </>
  );
}

/**
 * Signing in on the provider's page, step by step: open it, then (by what
 * comes back) copy the address of the page it ends on, copy the code it
 * shows, or enter the code given here and wait.
 */
function SignInSteps({
  step,
  prompt,
}: {
  step: Extract<LoginStep, { kind: "prompt" | "wait" }>;
  /** what is to be pasted, if anything */
  prompt: string | null;
}) {
  const t = useT();
  const page = step.device?.url ?? step.page;
  const open = page && (
    <Button
      variant="primary"
      className="mt-2"
      onClick={() => window.open(page, "_blank", "noopener,noreferrer")}
    >
      {step.device ? site(page) : t.keys.openPage}
    </Button>
  );
  if (step.device)
    return (
      <Steps>
        {[
          <>
            {t.keys.steps.open}
            <br />
            {open}
          </>,
          <>
            {t.keys.steps.enterCode}
            <DeviceCodeBox code={step.device.code} expires={step.device.expires} />
          </>,
          <span style={secondary}>{t.keys.steps.waiting}</span>,
        ]}
      </Steps>
    );
  if (prompt === "address" && step.kind === "prompt") {
    const begins = step.prompt.placeholder
      ? new URL(step.prompt.placeholder).origin
      : "http://localhost";
    return (
      <Steps>
        {[
          <>
            {t.keys.steps.open}
            <br />
            {open}
          </>,
          t.keys.steps.lands(begins),
          <>
            {t.keys.steps.copyAddress}
            <span className="mt-1 block text-[13px]" style={secondary}>
              {t.keys.steps.onPhone}
            </span>
          </>,
        ]}
      </Steps>
    );
  }
  if (prompt === "code")
    return (
      <Steps>
        {[
          <>
            {t.keys.steps.open}
            <br />
            {open}
          </>,
          t.keys.steps.codeShown,
          t.keys.steps.pasteCode,
        ]}
      </Steps>
    );
  return (
    <Steps>
      {[
        <>
          {t.keys.steps.open}
          <br />
          {open}
        </>,
        <span style={secondary}>{t.keys.steps.waiting}</span>,
      ]}
    </Steps>
  );
}

/** A device code to enter on the provider's page: large, copyable, and how long it still works. */
function DeviceCodeBox({ code, expires }: { code: string; expires: string | null }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!expires) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expires]);
  const left = expires ? Math.max(0, Date.parse(expires) - now) : null;
  const clock = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return (
    <span className="mt-2 flex flex-col items-start gap-2">
      <span
        className="select-all font-mono text-[22px] font-semibold tracking-[0.12em]"
        style={{ color: "var(--text-primary)" }}
      >
        {code}
      </span>
      <Button
        variant="secondary"
        onCard
        onClick={() =>
          void navigator.clipboard
            ?.writeText(code)
            .then(() => setCopied(true))
            .catch(() => {})
        }
      >
        {copied ? t.keys.copied : t.keys.copyCode}
      </Button>
      {left !== null && (
        <span
          className="text-[13px]"
          style={{ color: left === 0 ? "var(--fill-red)" : "var(--text-secondary)" }}
        >
          {left === 0 ? t.keys.codeExpired : t.keys.codeExpires(clock(left))}
        </span>
      )}
    </span>
  );
}

/** Keys being tried, by provider: testing, or how it went. */
export function useKeyTests(session: Session) {
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const test = (provider: string) => {
    setTests((t) => ({ ...t, [provider]: "testing" }));
    session.call("keys.test", { provider }).then(
      (result) => setTests((t) => ({ ...t, [provider]: result })),
      (e: unknown) =>
        setTests((t) => ({
          ...t,
          [provider]: {
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          },
        })),
    );
  };
  /** forget a result once the key changes */
  const clear = (provider: string) =>
    setTests(({ [provider]: _, ...rest }) => rest);
  return { tests, test, clear };
}

/** Where a key's test stands: not tried, being tried, or how it went. */
export type TestState = KeyTest | "testing" | undefined;

/** A key's line: its end (or that the user signed in), and how its test went (`brief`: only whether it works, for a list). */
export function KeyLine({
  hint,
  way = "key",
  test,
  brief = false,
}: {
  hint: string | null;
  /** how the provider is set up: a sign-in shows no key */
  way?: KeyWay | null;
  test: TestState;
  brief?: boolean;
}) {
  const t = useT();
  const failed = test !== undefined && test !== "testing" && !test.ok;
  return (
    <span
      className="block text-[13px] [overflow-wrap:anywhere]"
      style={{ color: failed ? "var(--fill-red)" : "var(--text-secondary)" }}
    >
      {way === "account"
        ? t.keys.signedIn
        : hint
          ? t.keys.keyHint(hint)
          : t.keys.keySet}
      {test === "testing" && ` · ${t.keys.testing}`}
      {test !== undefined &&
        test !== "testing" &&
        ` · ${test.ok ? t.keys.works : brief ? t.keys.notWorking : test.detail}`}
    </span>
  );
}
