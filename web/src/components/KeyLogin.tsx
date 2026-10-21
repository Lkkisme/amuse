/**
 * Setting up a provider's key: the provider's own sign-in, a prompt at a time
 * as the server relays it (its key, sometimes an account id or a region), in
 * a sheet from the bottom on a phone and a dialog on a desktop. The key goes
 * to the server and never comes back.
 */
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import type {
  KeyProvider,
  KeyTest,
  LoginStep,
  Session,
} from "@amuse/protocol";
import { Sheet } from "./Sheet";

export function KeyLogin({
  session,
  provider,
  onClose,
}: {
  session: Session;
  /** the provider being set up; null: closed */
  provider: KeyProvider | null;
  /** `done`: a key was set up */
  onClose: (done: boolean) => void;
}) {
  const [step, setStep] = useState<LoginStep | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // the provider shown while the sheet closes
  const [shown, setShown] = useState<KeyProvider | null>(provider);

  const settle = (next: Promise<LoginStep>) => {
    setBusy(true);
    next.then(
      (s) => {
        setBusy(false);
        setValue("");
        if (s.kind === "done") return onClose(true);
        setStep(s);
      },
      (e: unknown) => {
        setBusy(false);
        setStep({
          kind: "failed",
          reason: e instanceof Error ? e.message : String(e),
        });
      },
    );
  };
  const start = (id: string) =>
    settle(session.call("keys.login", { provider: id }));
  useEffect(() => {
    if (!provider) return;
    setShown(provider);
    setStep(null);
    setValue("");
    start(provider.id);
    // a new sign-in for each provider opened
  }, [provider]);

  const cancel = () => {
    if (step?.kind === "prompt")
      void session.call("keys.cancel", { login: step.login }).catch(() => {});
    onClose(false);
  };
  const answer = (given: string) => {
    if (step?.kind !== "prompt" || busy) return;
    settle(session.call("keys.answer", { login: step.login, value: given }));
  };

  const prompt = step?.kind === "prompt" ? step.prompt : null;
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
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {shown?.connected ? "Replace your API key" : "Add your API key"}
        </p>

        {step?.kind === "prompt" &&
          step.notes.map((note, i) => (
            <p
              key={i}
              className="mt-3 text-[14px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {note.message}{" "}
              {note.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "var(--fill-blue)" }}
                >
                  {link.label ?? link.url}
                </a>
              ))}
            </p>
          ))}

        {prompt && prompt.type !== "select" && (
          <form
            className="mt-5 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) answer(value);
            }}
          >
            <p
              className="mb-2 text-left text-[13px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              {prompt.message}
            </p>
            <input
              autoFocus
              aria-label={prompt.message}
              type={prompt.type === "secret" ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-[18px] px-4 py-3.5 text-[16px] outline-none"
              style={{
                background: "var(--field)",
                color: "var(--text-primary)",
              }}
              placeholder={prompt.placeholder ?? ""}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button
              type="submit"
              disabled={!value.trim() || busy}
              className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--fill-blue)" }}
            >
              Continue
            </button>
          </form>
        )}

        {prompt?.type === "select" && (
          <div className="mt-5 w-full text-left">
            <p
              className="mb-2 text-[13px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
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
                      <span
                        className="block text-[13px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {option.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === null && (
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
            <button
              className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white"
              style={{ background: "var(--fill-blue)" }}
              onClick={() => shown && start(shown.id)}
            >
              Try again
            </button>
          </>
        )}

        <button
          className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
          style={{ color: "var(--text-primary)" }}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </Sheet>
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

/** A key's line: its end, and how its test went (`brief`: only whether it works, for a list). */
export function KeyLine({
  hint,
  test,
  brief = false,
}: {
  hint: string | null;
  test: TestState;
  brief?: boolean;
}) {
  const failed = test !== undefined && test !== "testing" && !test.ok;
  return (
    <span
      className="block text-[13px] [overflow-wrap:anywhere]"
      style={{ color: failed ? "var(--fill-red)" : "var(--text-secondary)" }}
    >
      {hint ? `Key ${hint}` : "Key set"}
      {test === "testing" && " · Testing…"}
      {test !== undefined &&
        test !== "testing" &&
        ` · ${test.ok ? "Works" : brief ? "Not working" : test.detail}`}
    </span>
  );
}
