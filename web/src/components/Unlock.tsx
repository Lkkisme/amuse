/**
 * The way in on a device: the master password. The very first visit sets it
 * (typed twice); after that it opens Muse on each device once.
 */
import { useState } from "react";
import { Button } from "./Button";
import { enter } from "../connection.ts";
import { useT } from "../i18n/react.ts";

export function Unlock({ ready }: { ready: boolean }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field =
    "h-11 w-full max-w-xs rounded-full px-4 text-[15px] outline-none";
  const look = {
    background: "var(--fill-primary)",
    color: "var(--text-primary)",
    boxShadow: "var(--shadow-float)",
  };

  return (
    <form
      className="flex h-full flex-col items-center justify-center gap-4 p-6"
      style={{ background: "var(--chat-background)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || busy) return;
        if (!ready && password !== again)
          return setProblem(t.unlock.mismatch);
        setBusy(true);
        void enter(password, !ready).then((why) => {
          setBusy(false);
          setProblem(why);
        });
      }}
    >
      <span
        className="flex size-14 items-center justify-center rounded-full text-[22px] font-semibold"
        style={{
          background: "var(--avatar-fill)",
          color: "var(--avatar-text)",
          boxShadow: "var(--shadow-float)",
        }}
      >
        A
      </span>
      <div className="max-w-xs text-center">
        <p
          className="text-[17px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {ready ? t.unlock.welcome : t.unlock.setTitle}
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {ready ? t.unlock.enterHelp : t.unlock.setHelp}
        </p>
      </div>
      <input
        autoFocus
        type="password"
        autoComplete={ready ? "current-password" : "new-password"}
        aria-label={t.unlock.password}
        placeholder={t.unlock.password}
        className={field}
        style={look}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {!ready && (
        <input
          type="password"
          autoComplete="new-password"
          aria-label={t.unlock.passwordAgain}
          placeholder={t.unlock.passwordAgain}
          className={field}
          style={look}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      )}
      {problem && (
        <p
          className="max-w-xs text-center text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {problem}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        className="max-w-xs"
        type="submit"
        disabled={busy}
      >
        {ready ? t.common.continue : t.unlock.setButton}
      </Button>
    </form>
  );
}
