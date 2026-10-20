/**
 * A browser run's live desktop — the real Chrome window, tabs and address bar
 * included — over noVNC, drawn into our own box and scaled to fit (the
 * desktop keeps its size; we never ask it to resize). Input is off unless the
 * user holds the run, here and, regardless, at the server's gate. Phones get
 * a keyboard button: what its hidden input commits is typed as keystrokes.
 */
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import RFB from "@novnc/novnc";

/** X keysym for a character: Latin-1 maps directly, the rest of Unicode is offset. */
const keysym = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x100 ? code : 0x01000000 + code;
};
const namedKeys: Record<string, number> = { Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b };

export function LiveView({ url, interactive }: { url: string; interactive: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const typing = useRef<HTMLInputElement>(null);
  const client = useRef<RFB | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "gone">("connecting");

  useEffect(() => {
    const target = box.current;
    if (!target) return;
    const rfb = new RFB(target, url, { wsProtocols: ["binary"] });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.background = "transparent";
    rfb.addEventListener("connect", () => setState("live"));
    rfb.addEventListener("disconnect", () => setState("gone"));
    client.current = rfb;
    return () => {
      client.current = null;
      rfb.disconnect();
    };
  }, [url]);

  useEffect(() => {
    const rfb = client.current;
    if (!rfb) return;
    rfb.viewOnly = !interactive;
    rfb.focusOnClick = interactive;
  }, [interactive, state]);

  const press = (sym: number) => {
    client.current?.sendKey(sym, null, true);
    client.current?.sendKey(sym, null, false);
  };

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ background: "var(--bg-secondary)" }}>
      <div ref={box} className="absolute inset-0" style={{ cursor: interactive ? "default" : "not-allowed" }} />

      {interactive && (
        <>
          <input
            ref={typing}
            aria-label="Type into the page"
            className="absolute bottom-0 left-0 size-px opacity-0"
            onInput={(e) => {
              for (const char of e.currentTarget.value) press(keysym(char));
              e.currentTarget.value = "";
            }}
            onKeyDown={(e) => {
              const sym = namedKeys[e.key];
              if (sym !== undefined) {
                e.preventDefault();
                press(sym);
              }
            }}
          />
          <button
            aria-label="Show keyboard"
            className="absolute bottom-4 right-4 flex size-11 items-center justify-center rounded-full md:hidden"
            style={{ background: "var(--fill-primary)", color: "var(--icon-primary)", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}
            onClick={() => typing.current?.focus()}
          >
            <Keyboard size={20} />
          </button>
        </>
      )}

      {state !== "live" && (
        <p className="absolute text-[14px]" style={{ color: "var(--text-secondary)" }}>
          {state === "connecting" ? "Connecting to the browser…" : "This browser is no longer live."}
        </p>
      )}
    </div>
  );
}
