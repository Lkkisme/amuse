/**
 * The way in on a device: the master password. The very first visit sets it
 * (typed twice); after that it opens Muse on each device once.
 */
import { useState } from "react";
import { enter } from "../connection.ts";

export function Unlock({ ready }: { ready: boolean }) {
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
          return setProblem("The two passwords are not the same.");
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
        M
      </span>
      <div className="max-w-xs text-center">
        <p
          className="text-[17px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {ready ? "Welcome back" : "Set a password"}
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {ready
            ? "Enter your password to open Muse on this device."
            : "Muse is new here. Choose the password that opens it, on this device and any other."}
        </p>
      </div>
      <input
        autoFocus
        type="password"
        autoComplete={ready ? "current-password" : "new-password"}
        aria-label="Password"
        placeholder="Password"
        className={field}
        style={look}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {!ready && (
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Password again"
          placeholder="Password again"
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
      <button
        type="submit"
        disabled={busy}
        className="h-10 rounded-full px-6 text-[15px] font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--fill-blue)" }}
      >
        {ready ? "Continue" : "Set password"}
      </button>
    </form>
  );
}
