/** First visit on a device: the access token, once. */
import { useEffect, useState } from "react";
import { unlock } from "../connection.ts";

export function Unlock() {
  const [token, setToken] = useState("");
  const [wrong, setWrong] = useState(false);
  // a #token=… link opened in this same tab only changes the hash; take it from there
  useEffect(() => {
    const fromLink = () => {
      const t = new URLSearchParams(location.hash.slice(1)).get("token");
      if (t) {
        history.replaceState(null, "", location.pathname + location.search);
        void unlock(t).then((ok) => setWrong(!ok));
      }
    };
    window.addEventListener("hashchange", fromLink);
    return () => window.removeEventListener("hashchange", fromLink);
  }, []);
  return (
    <form
      className="flex h-full flex-col items-center justify-center gap-4 p-6"
      style={{ background: "var(--chat-background)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) void unlock(token).then((ok) => setWrong(!ok));
      }}
    >
      <span
        className="flex size-14 items-center justify-center rounded-full text-[22px] font-semibold"
        style={{ background: "var(--avatar-fill)", color: "var(--avatar-text)", boxShadow: "var(--shadow-float)" }}
      >
        M
      </span>
      <p className="text-[15px]" style={{ color: "var(--text-secondary)" }}>
        Enter your access token to open Muse on this device.
      </p>
      <input
        autoFocus
        type="password"
        aria-label="Access token"
        className="h-11 w-full max-w-xs rounded-full px-4 text-[15px] outline-none"
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "var(--shadow-float)" }}
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      {wrong && (
        <p className="text-[13px]" style={{ color: "var(--fill-red)" }}>
          That token did not work.
        </p>
      )}
      <button type="submit" className="h-10 rounded-full px-6 text-[15px] font-semibold text-white" style={{ background: "var(--fill-blue)" }}>
        Continue
      </button>
    </form>
  );
}
