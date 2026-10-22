/**
 * The sandbox's terminals: herdr's own interface (its workspaces, tabs and
 * panes, and what each agent in them is doing), the same terminals Amuse
 * works in, shown with xterm.js over the server's /terminal socket. Picking a
 * workspace or a pane is done in herdr, with the mouse or its keys (ctrl+b).
 * It sizes itself to the viewer and tells the sandbox when that changes.
 * Closing it, or herdr's detach (ctrl+b q), only leaves: what runs there goes
 * on. On a touch screen a row of keys the phone's keyboard lacks sits under
 * it: Esc, Tab, the arrows, herdr's prefix, and Ctrl and Alt for the next key.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Ctrl and Alt held for the next key typed on the phone's keyboard (or the next key of the row). */
type Mods = { ctrl: boolean; alt: boolean };
const NONE: Mods = { ctrl: false, alt: false };

/** A key typed with `mods`: Ctrl makes a control character of a letter (and of @[\\]^_ and space), Alt puts Esc before. */
function modified(data: string, mods: Mods): string {
  let key = data;
  if (mods.ctrl && key.length === 1) {
    const code = key.toUpperCase().charCodeAt(0);
    if (key === " ") key = "\x00";
    else if (code >= 64 && code <= 95) key = String.fromCharCode(code - 64);
  }
  return mods.alt ? `\x1b${key}` : key;
}

/** An arrow (A up, B down, C right, D left) as the terminal's mode wants it, with Ctrl and Alt as xterm sends them. */
function arrow(letter: "A" | "B" | "C" | "D", application: boolean, mods: Mods): string {
  const code = 1 + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
  if (code > 1) return `\x1b[1;${code}${letter}`;
  return application ? `\x1bO${letter}` : `\x1b[${letter}`;
}

type Phase = "opening" | "open" | { closed: number };

/** What the server's close code means, for the user (api/src/terminal.ts). */
function closedCopy(code: number): { title: string; text: string; again: boolean } {
  if (code === 4404)
    return {
      title: "No terminals here",
      text: "This Amuse has no sandbox, so there are no terminals to show.",
      again: false,
    };
  if (code === 4429)
    return {
      title: "Too many terminals open",
      text: "Close the terminal on another device or tab, then try again.",
      again: true,
    };
  if (code === 1000)
    return {
      title: "Terminal closed",
      text: "What runs in the terminals keeps running.",
      again: true,
    };
  return {
    title: "The terminals cannot be reached",
    text: "The sandbox may be starting or restarting.",
    again: true,
  };
}

const encoder = new TextEncoder();

export function TerminalView({
  url,
  visible,
}: {
  url: (cols: number, rows: number) => string;
  /** shown now: it keeps its connection while the viewer shows the browser */
  visible: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  /** what the row's keys type into (the open socket's sender) */
  const sender = useRef<((data: string) => void) | null>(null);
  const [mods, setMods] = useState<Mods>(NONE);
  const held = useRef<Mods>(NONE);
  const hold = (next: Mods) => {
    held.current = next;
    setMods(next);
  };
  const [phase, setPhase] = useState<Phase>("opening");
  // a new connection each time the user opens it again
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setPhase("opening");
    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      macOptionIsMeta: true,
      // herdr keeps each pane's history
      scrollback: 0,
      theme: { background: "#1c1c1e", foreground: "#e5e5ea" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    terminal.current = term;
    // hidden (display none) it has no size: it is fitted when it is shown
    const fitted = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
    };
    fitted();

    const ws = new WebSocket(url(term.cols, term.rows));
    ws.binaryType = "arraybuffer";
    const send = (bytes: Uint8Array) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
    };
    ws.onopen = () => {
      setPhase("open");
      // the size it was opened at may be out of date (it was hidden, or the window moved)
      fitted();
      ws.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    };
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data));
    };
    ws.onclose = (event) => setPhase({ closed: event.code });
    // what is typed, with Ctrl or Alt from the row for one key (a key: one character, not a mouse report or a paste)
    const type = (data: string) => {
      const mods = held.current;
      if ((mods.ctrl || mods.alt) && data.length === 1) {
        hold(NONE);
        send(encoder.encode(modified(data, mods)));
      } else send(encoder.encode(data));
    };
    sender.current = (data) => send(encoder.encode(data));
    const typed = term.onData(type);
    // mouse reports in the old encoding come as bytes past ASCII
    const binary = term.onBinary((data) =>
      send(Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff)),
    );
    const resized = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    const observer = new ResizeObserver(fitted);
    observer.observe(el);
    return () => {
      observer.disconnect();
      typed.dispose();
      binary.dispose();
      resized.dispose();
      ws.onclose = null;
      ws.close();
      term.dispose();
      terminal.current = null;
      sender.current = null;
    };
  }, [url, attempt]);

  // shown: typing goes to it
  useEffect(() => {
    if (visible && phase === "open") terminal.current?.focus();
  }, [visible, phase]);

  const closed = typeof phase === "object" ? closedCopy(phase.closed) : null;
  return (
    <div
      className={`${visible ? "flex" : "hidden"} relative min-h-0 flex-1 flex-col p-2 pt-0 lg:p-3 lg:pt-0`}
    >
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-[16px] p-2"
        style={{ background: "#1c1c1e" }}
      >
        <div ref={box} className="size-full" />
        {closed && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
            style={{ background: "rgba(28, 28, 30, 0.92)" }}
          >
            <SquareTerminal size={28} style={{ color: "#8e8e93" }} />
            <p className="text-[15px] font-semibold" style={{ color: "#f2f2f7" }}>
              {closed.title}
            </p>
            <p className="max-w-[300px] text-[14px]" style={{ color: "#aeaeb2" }}>
              {closed.text}
            </p>
            {closed.again && (
              <button
                className="hover-fade mt-3 h-10 rounded-full px-4 text-[15px] font-medium"
                style={{ background: "#3a3a3c", color: "#f2f2f7" }}
                onClick={() => setAttempt((n) => n + 1)}
              >
                Open again
              </button>
            )}
          </div>
        )}
      </div>
      <KeyRow
        mods={mods}
        onMods={hold}
        onKey={(data) => {
          sender.current?.(data);
          hold(NONE);
        }}
        application={() =>
          terminal.current?.modes.applicationCursorKeysMode ?? false
        }
      />
    </div>
  );
}

/**
 * Touch screens only: keys the phone's keyboard does not have. Pressing one
 * keeps the focus (and the keyboard) where it is.
 */
function KeyRow({
  mods,
  onMods,
  onKey,
  application,
}: {
  mods: Mods;
  onMods: (mods: Mods) => void;
  onKey: (data: string) => void;
  /** whether the terminal wants arrows in its application form */
  application: () => boolean;
}) {
  const keys: { label: string; aria: string; press: () => void; on?: boolean }[] = [
    { label: "Esc", aria: "Escape", press: () => onKey(modified("\x1b", mods)) },
    {
      label: "Ctrl",
      aria: "Control, for the next key",
      on: mods.ctrl,
      press: () => onMods({ ...mods, ctrl: !mods.ctrl }),
    },
    {
      label: "Alt",
      aria: "Alt, for the next key",
      on: mods.alt,
      press: () => onMods({ ...mods, alt: !mods.alt }),
    },
    { label: "Tab", aria: "Tab", press: () => onKey(modified("\t", mods)) },
    { label: "^B", aria: "herdr's prefix, Control B", press: () => onKey("\x02") },
    { label: "←", aria: "Left", press: () => onKey(arrow("D", application(), mods)) },
    { label: "↑", aria: "Up", press: () => onKey(arrow("A", application(), mods)) },
    { label: "↓", aria: "Down", press: () => onKey(arrow("B", application(), mods)) },
    { label: "→", aria: "Right", press: () => onKey(arrow("C", application(), mods)) },
  ];
  return (
    <div className="hidden gap-1.5 overflow-x-auto pt-2 [scrollbar-width:none] pointer-coarse:flex">
      {keys.map(({ label, aria, press, on }) => (
        <button
          key={label}
          aria-label={aria}
          aria-pressed={on}
          className="h-10 min-w-11 shrink-0 rounded-[10px] px-2.5 font-mono text-[14px] font-medium"
          style={{
            background: on ? "var(--fill-blue)" : "var(--fill-secondary)",
            color: on ? "white" : "var(--text-primary)",
          }}
          // the keyboard stays up: the terminal keeps the focus
          onPointerDown={(e) => e.preventDefault()}
          onClick={press}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
