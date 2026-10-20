/** First visit on a device: the access token, once. */
import { useEffect, useState } from "react";
import { unlock } from "../connection.ts";

export function Unlock() {
  const [token, setToken] = useState("");
  // a #token=… link opened in this same tab only changes the hash; take it from there
  useEffect(() => {
    const fromLink = () => {
      const t = new URLSearchParams(location.hash.slice(1)).get("token");
      if (t) unlock(t);
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
        if (token.trim()) unlock(token);
      }}
    >
      <span
        className="flex size-14 items-center justify-center rounded-full text-[22px] font-semibold"
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.10)" }}
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
        style={{ background: "var(--fill-primary)", color: "var(--text-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <button type="submit" className="h-10 rounded-full px-6 text-[15px] font-semibold text-white" style={{ background: "var(--fill-blue)" }}>
        Continue
      </button>
    </form>
  );
}
