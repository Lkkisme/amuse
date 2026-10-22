/**
 * A browser run's live desktop — the real Chrome window, tabs and address bar
 * included — over noVNC, drawn into our own box and scaled to fit (the
 * desktop keeps its size; we never ask it to resize). Input is off unless the
 * user holds the run, here and, regardless, at the server's gate.
 *
 * While the user holds it on a touch screen, a strip of controls sits under
 * the desktop, never over it: the keyboard, paste, a trackpad mode, a zoom to
 * actual size, and the keys a phone keyboard lacks. Fingers on the desktop
 * are read as phone gestures by TouchSurface. The app shrinks to what the on-screen
 * keyboard leaves (main.tsx), so the strip rides on top of the keyboard and
 * the desktop scales into what is left. On a desktop computer, the paste
 * shortcut pastes this computer's clipboard, and what is copied there comes
 * back here.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Keyboard, KeyboardOff, MousePointer2, ZoomIn } from "lucide-react";
import RFB from "@novnc/novnc";
import { FILLER, edit, keys, runs } from "../remote-keys.ts";
import { TouchSurface } from "./TouchSurface";
import { useT } from "../i18n/react.ts";

const touchScreen = () => window.matchMedia("(pointer: coarse)").matches;


/** Width change (px) that reshapes the desktop again: a turned phone, a resized window; not the keyboard (height only). */
const REFIT = 24;

export function LiveView({ url, interactive, onFit }: { url: string; interactive: boolean; onFit: (view: { width: number; height: number } | null) => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const client = useRef<RFB | null>(null);
  /** the viewer shows only runs whose browser is there, so a dropped or refused connection is tried again */
  const [state, setState] = useState<"connecting" | "live">("connecting");
  const [attempt, setAttempt] = useState(0);
  const [touch] = useState(touchScreen);
  const [trackpad, setTrackpad] = useState(false);
  /** actual size instead of fit: the desktop is bigger than the box, dragged around to see it all */
  const [zoom, setZoom] = useState(false);

  const failures = useRef(0);
  useEffect(() => {
    const target = box.current;
    if (!target) return;
    const rfb = new RFB(target, url, { wsProtocols: ["binary"] });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.background = "transparent";
    let retry: ReturnType<typeof setTimeout> | undefined;
    let left = false; // our own disconnect on leaving is not a dropped connection
    rfb.addEventListener("connect", () => {
      failures.current = 0;
      setState("live");
    });
    // a run still opening its browser is refused; one whose connection dropped comes back: try again, slower each time
    rfb.addEventListener("disconnect", () => {
      if (left) return;
      setState("connecting");
      retry = setTimeout(() => setAttempt((a) => a + 1), Math.min(5000, 500 * 2 ** failures.current++));
    });
    // copied on the remote desktop: offer it to this device's clipboard (needs a secure page; best effort)
    rfb.addEventListener("clipboard", (e) => void navigator.clipboard?.writeText(e.detail.text).catch(() => {}));
    client.current = rfb;
    return () => {
      left = true;
      clearTimeout(retry);
      client.current = null;
      rfb.disconnect();
    };
  }, [url, attempt]);

  useEffect(() => {
    const rfb = client.current;
    if (!rfb) return;
    rfb.viewOnly = !interactive;
    // on touch screens our hidden field takes the keys; focusing the canvas would close the keyboard
    rfb.focusOnClick = interactive && !touch;
    rfb.showDotCursor = trackpad;
    // actual size: the full desktop in noVNC's scrolling screen, panned by TouchSurface
    rfb.scaleViewport = !zoom;
  }, [interactive, state, touch, trackpad, zoom]);

  /** Send keys, pressed and released in order, with Ctrl held around them when asked. */
  const press = (syms: number[], ctrl = false) => {
    const rfb = client.current;
    if (!rfb) return;
    if (ctrl) rfb.sendKey(keys.Control, null, true);
    for (const sym of syms) {
      rfb.sendKey(sym, null, true);
      rfb.sendKey(sym, null, false);
    }
    if (ctrl) rfb.sendKey(keys.Control, null, false);
  };
  /** Put text on the remote clipboard and paste it: how text that is not plain keys gets typed. */
  const paste = (text: string) => {
    const rfb = client.current;
    if (!rfb || !text) return;
    for (const held of [keys.Meta, keys.Super, keys.Control]) rfb.sendKey(held, null, false); // a shortcut's own modifiers
    rfb.clipboardPasteFrom(text);
    press([keys.V], true);
  };
  const type = (text: string, ctrl = false) => {
    for (const run of runs(text)) {
      if (run.kind === "keys") press(run.syms, ctrl);
      else paste(run.text);
    }
  };

  // desktop: the paste shortcut pastes this computer's clipboard. Keep the keydown from noVNC so
  // the browser fires `paste`, and paste its text instead of the remote's own clipboard.
  useEffect(() => {
    const target = box.current;
    if (!target || !interactive || touch) return;
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") e.stopPropagation();
    };
    const pasted = (e: ClipboardEvent) => {
      e.preventDefault();
      paste(e.clipboardData?.getData("text/plain") ?? "");
    };
    target.addEventListener("keydown", shortcut, true);
    target.addEventListener("paste", pasted);
    return () => {
      target.removeEventListener("keydown", shortcut, true);
      target.removeEventListener("paste", pasted);
    };
  }, [interactive, touch]);

  // while the browser is viewed, its desktop takes this view's shape (the server keeps it within sane sizes);
  // when it no longer is, back to the standard size
  const fit = useRef(onFit);
  fit.current = onFit;
  useEffect(() => {
    const target = box.current;
    if (!target || state !== "live") return;
    let fittedWidth = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const { width, height } = target.getBoundingClientRect();
      if (Math.abs(width - fittedWidth) < REFIT) return;
      fittedWidth = width;
      fit.current({ width: Math.round(width), height: Math.round(height) });
    };
    // while the view is being resized (its edge dragged), reshape the desktop once it settles
    const watch = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(measure, fittedWidth === 0 ? 0 : 300);
    });
    watch.observe(target);
    return () => {
      clearTimeout(settle);
      watch.disconnect();
      fit.current(null);
    };
  }, [state]);

  const controls = interactive && touch && state === "live";

  return (
    // nothing here is the phone's to select or long-press: Firefox would select the page and pop its
    // Copy / Select all menu instead of letting the desktop see the press
    <div
      className="remote-surface flex min-h-0 flex-1 flex-col"
      style={{ background: "var(--bg-secondary)" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ touchAction: "none" }}>
        <div ref={box} className="absolute inset-0" data-watching={interactive ? undefined : ""} />
        {state === "connecting" && <div aria-label={t.viewer.keyConnecting} className="skeleton absolute inset-0" />}
        {controls && <TouchSurface screen={box} mode={trackpad ? "trackpad" : zoom ? "pan" : "touch"} />}
      </div>
      {controls && (
        <TouchControls
          keys={{ type, press, paste }}
          trackpad={trackpad}
          onTrackpad={() => {
            setTrackpad((v) => !v);
            setZoom(false); // one way of pointing at a time
          }}
          zoom={zoom}
          onZoom={() => {
            setZoom((v) => !v);
            setTrackpad(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- the strip ---------- */

interface Sender {
  type: (text: string, ctrl?: boolean) => void;
  press: (syms: number[], ctrl?: boolean) => void;
  paste: (text: string) => void;
}

interface Modes {
  trackpad: boolean;
  onTrackpad: () => void;
  zoom: boolean;
  onZoom: () => void;
}

/**
 * One row under the desktop, fitting a phone's width. With the keyboard down:
 * keyboard, paste, trackpad, zoom and the arrows. With it up, the keys a phone
 * keyboard lacks take the modes' place: Esc, Tab, Ctrl (held for the next
 * key), the arrows. Too narrow a screen scrolls the row sideways rather than
 * wrap it over anything. Buttons leave focus where it is, so the keyboard
 * stays up while they are used.
 */
function TouchControls({ keys: send, trackpad, onTrackpad, zoom, onZoom }: { keys: Sender } & Modes) {
  const t = useT();
  const field = useRef<HTMLTextAreaElement>(null);
  const [typing, setTyping] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  /** text the keyboard is still composing (pinyin, a word in progress): shown here, sent when committed */
  const [composing, setComposing] = useState<string | null>(null);

  const reset = () => {
    const f = field.current;
    if (!f) return;
    f.value = FILLER;
    f.setSelectionRange(FILLER.length, FILLER.length);
  };
  useEffect(reset, []);

  /** What the field now holds, sent as backspaces and text; then back to filler. */
  const commit = () => {
    const f = field.current;
    if (!f) return;
    const { backspaces, text } = edit(FILLER, f.value.slice(0, f.selectionEnd));
    if (backspaces > 0) send.press(Array<number>(backspaces).fill(keys.Backspace), ctrl);
    if (text) send.type(text, ctrl);
    if (ctrl && (backspaces > 0 || text)) setCtrl(false);
    reset();
  };

  const key = (sym: number) => {
    send.press([sym], ctrl);
    setCtrl(false);
  };
  const pasteClipboard = async () => {
    const text = await navigator.clipboard?.readText?.().catch(() => null);
    if (text) return send.paste(text);
    field.current?.focus(); // no clipboard access here: the keyboard's own paste works into the field
  };

  return (
    <div
      className="flex h-[52px] shrink-0 items-center justify-center-safe gap-1 overflow-x-auto px-1.5"
      style={{ background: "var(--fill-primary)", borderTop: "1px solid var(--fill-divider)", scrollbarWidth: "none" }}
      onPointerDown={(e) => {
        if (e.target instanceof Element && e.target.closest("button")) e.preventDefault(); // keep the keyboard up
      }}
    >
      <textarea
        ref={field}
        aria-label={t.viewer.typeIntoPage}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="pointer-events-none absolute size-px opacity-0"
        style={{ fontSize: 16 }} // under 16px, iOS zooms the page on focus
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        onCompositionStart={() => setComposing("")}
        onCompositionUpdate={(e) => setComposing(e.data)}
        onCompositionEnd={() => {
          setComposing(null);
          commit();
        }}
        onInput={(e) => {
          if (!(e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing)) commit();
        }}
        onKeyDown={(e) => {
          // keys that leave the field unchanged still mean something on the page
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            key(keys.Enter);
          } else if (e.key === "Backspace" && e.currentTarget.selectionEnd === 0) {
            e.preventDefault();
            key(keys.Backspace);
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          send.paste(e.clipboardData.getData("text/plain"));
        }}
      />
      <Tool label={typing ? t.viewer.hideKeyboard : t.viewer.showKeyboard} active={typing} onClick={() => (typing ? field.current?.blur() : field.current?.focus())}>
        {typing ? <KeyboardOff size={18} /> : <Keyboard size={18} />}
      </Tool>
      <Tool label={t.viewer.paste} onClick={() => void pasteClipboard()}>
        <ClipboardPaste size={17} />
      </Tool>
      {!typing && (
        <>
          <Tool label={t.viewer.trackpad} active={trackpad} onClick={onTrackpad}>
            <MousePointer2 size={17} />
          </Tool>
          <Tool label={t.viewer.actualSize} active={zoom} onClick={onZoom}>
            <ZoomIn size={17} />
          </Tool>
        </>
      )}
      <span className="mx-0.5 h-6 w-px shrink-0" style={{ background: "var(--fill-divider)" }} />
      {composing ? (
        <span className="truncate px-2 text-[15px]" style={{ color: "var(--text-secondary)" }}>
          {composing}
        </span>
      ) : (
        <>
          {typing && (
            <>
              <Tool label={t.viewer.keyEscape} text onClick={() => key(keys.Escape)}>
                Esc
              </Tool>
              <Tool label="Tab" text onClick={() => key(keys.Tab)}>
                Tab
              </Tool>
              <Tool label={t.viewer.keyControlName} text active={ctrl} onClick={() => setCtrl((v) => !v)}>
                Ctrl
              </Tool>
            </>
          )}
          <Tool label={t.viewer.keyLeft} onClick={() => key(keys.Left)}>
            <ArrowLeft size={16} />
          </Tool>
          <Tool label={t.viewer.keyUp} onClick={() => key(keys.Up)}>
            <ArrowUp size={16} />
          </Tool>
          <Tool label={t.viewer.keyDown} onClick={() => key(keys.Down)}>
            <ArrowDown size={16} />
          </Tool>
          <Tool label={t.viewer.keyRight} onClick={() => key(keys.Right)}>
            <ArrowRight size={16} />
          </Tool>
        </>
      )}
    </div>
  );
}

function Tool({ label, active = false, text = false, onClick, children }: { label: string; active?: boolean; text?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`flex h-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-medium ${text ? "px-2.5" : "w-[34px]"}`}
      style={{ background: active ? "var(--fill-blue)" : "var(--fill-secondary)", color: active ? "#fff" : "var(--icon-primary)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
