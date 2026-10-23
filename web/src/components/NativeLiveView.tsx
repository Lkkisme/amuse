/** A native browser's CDP image stream, with input sent through the server's control gate. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { keys } from "../remote-keys.ts";
import { TouchSurface } from "./TouchSurface";
import { useT } from "../i18n/react.ts";
import { activeT } from "../i18n/language.ts";
import { changedViewport, contained, frameFits, frameOf, nativeFrameHasResolution, type Frame } from "../native-frames.ts";

type Generation = string | number;
type Size = { width: number; height: number };
type Ready = Size & { generation: Generation; url: string; title: string; tagged: boolean; viewerFit: boolean };
type Sender = {
  type(text: string, ctrl?: boolean): void;
  press(syms: number[], ctrl?: boolean): void;
  paste(text: string): void;
};
type Modes = { trackpad: boolean; onTrackpad(): void; zoom: boolean; onZoom(): void };
type Key = { key: string; code: string };
type Point = { x: number; y: number; button: number; generation: Generation };

const keyNames: Record<number, Key> = {
  [keys.Enter]: { key: "Enter", code: "Enter" },
  [keys.Backspace]: { key: "Backspace", code: "Backspace" },
  [keys.Tab]: { key: "Tab", code: "Tab" },
  [keys.Escape]: { key: "Escape", code: "Escape" },
  [keys.Left]: { key: "ArrowLeft", code: "ArrowLeft" },
  [keys.Up]: { key: "ArrowUp", code: "ArrowUp" },
  [keys.Right]: { key: "ArrowRight", code: "ArrowRight" },
  [keys.Down]: { key: "ArrowDown", code: "ArrowDown" },
};
const control: Key = { key: "Control", code: "ControlLeft" };
const modifiersOf = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
const characterKey = (char: string): Key => ({
  key: char,
  code: /^[a-z]$/i.test(char) ? `Key${char.toUpperCase()}` : /^[0-9]$/.test(char) ? `Digit${char}` : char === " " ? "Space" : "",
});

function readyOf(value: unknown): Ready | null {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "ready" ||
    !("width" in value) || typeof value.width !== "number" || !Number.isFinite(value.width) || value.width <= 0 ||
    !("height" in value) || typeof value.height !== "number" || !Number.isFinite(value.height) || value.height <= 0 ||
    !("generation" in value) || (typeof value.generation !== "string" && typeof value.generation !== "number")) return null;
  return {
    width: value.width, height: value.height, generation: value.generation,
    url: "url" in value && typeof value.url === "string" ? value.url : "",
    title: "title" in value && typeof value.title === "string" ? value.title : "",
    tagged: "frames" in value && value.frames === "tagged",
    viewerFit: "viewportControl" in value && value.viewportControl === "viewer",
  };
}

async function decodedFrame(blob: Blob): Promise<Size & { image: CanvasImageSource; close(): void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Some phone browsers need the ordinary image decoder. */ }
  }
  const objectURL = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = objectURL;
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectURL) };
  } catch (error) {
    URL.revokeObjectURL(objectURL);
    throw error;
  }
}

export function NativeLiveView({ url, interactive, onFit, initialSize, renderControls }: {
  url: string;
  interactive: boolean;
  onFit(view: Size | null): void;
  initialSize: Size;
  renderControls(send: Sender, modes: Modes): ReactNode;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const ready = useRef<Ready | null>(null);
  const latest = useRef(interactive);
  latest.current = interactive;
  const [state, setState] = useState<"connecting" | "live" | "failed">("connecting");
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [metadata, setMetadata] = useState<Ready | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [address, setAddress] = useState("");
  const [addressProblem, setAddressProblem] = useState<string | null>(null);
  const editingAddress = useRef(false);
  const [touch] = useState(() => matchMedia("(pointer: coarse)").matches);
  const [trackpad, setTrackpad] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const composing = useRef(false);
  const committedComposition = useRef<string | null>(null);
  const heldKeys = useRef(new Map<string, Key>());
  const heldPointer = useRef<Point | null>(null);

  /** A ready socket is still read-only until the enclosing viewer grants control. */
  const send = (message: object) => {
    const client = socket.current;
    if (!latest.current || !ready.current || !client || client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(message));
  };
  const sendKey = (action: "down" | "up", key: Key, modifiers = 0) => send({ type: "key", action, ...key, modifiers });
  const paste = (text: string) => { if (text) send({ type: "text", text }); };
  const press = (syms: number[], ctrl = false) => {
    if (ctrl) sendKey("down", control, 2);
    for (const sym of syms) {
      const key = keyNames[sym] ?? (sym >= 0x20 && sym < 0x7f ? characterKey(String.fromCodePoint(sym)) : null);
      if (!key) continue;
      sendKey("down", key, ctrl ? 2 : 0);
      sendKey("up", key, ctrl ? 2 : 0);
    }
    if (ctrl) sendKey("up", control);
  };
  const type = (text: string, ctrl = false) => {
    if (!ctrl) return paste(text);
    for (const char of text) {
      const sym = char.codePointAt(0) ?? 0;
      if (sym >= 0x20 && sym < 0x7f) press([sym], true);
      else paste(char);
    }
  };
  const releaseInput = () => {
    for (const key of heldKeys.current.values()) sendKey("up", key);
    heldKeys.current.clear();
    if (heldPointer.current) send({ type: "pointer", action: "up", ...heldPointer.current });
    heldPointer.current = null;
  };
  const currentRelease = useRef(releaseInput);
  currentRelease.current = releaseInput;

  useEffect(() => {
    const client = new WebSocket(url);
    client.binaryType = "arraybuffer";
    socket.current = client;
    ready.current = null;
    heldKeys.current.clear();
    heldPointer.current = null;
    setState("connecting");
    setProblem(null);
    let left = false;
    let failed = false;
    let decoding = false;
    // At most one frame is decoded and one newer frame waits. Incoming frames replace the waiting one.
    let pending: { blob: Blob; metadata: Frame } | null = null;
    let frameMetadata: Frame | null = null;
    const fail = (message: string) => {
      if (left || failed) return;
      failed = true;
      ready.current = null;
      pending = null;
      clearTimeout(timeout);
      setProblem(message);
      setState("failed");
      client.close();
    };
    const timeout = setTimeout(() => fail(activeT().localBrowser.readyTimeout), 12_000);
    const draw = async () => {
      if (decoding || !pending || left || failed) return;
      const frame = pending;
      pending = null;
      decoding = true;
      let decoded: Awaited<ReturnType<typeof decodedFrame>> | null = null;
      try {
        decoded = await decodedFrame(frame.blob);
        const current = ready.current;
        const target = canvas.current;
        if (!left && !failed && current?.generation === frame.metadata.generation &&
          current.width === frame.metadata.width && current.height === frame.metadata.height &&
          frameFits(decoded, current) && (!current.tagged || nativeFrameHasResolution(decoded, current)) && target) {
          const context = target.getContext("2d");
          if (!context) throw new Error("Canvas is unavailable");
          if (target.width !== current.width) target.width = current.width;
          if (target.height !== current.height) target.height = current.height;
          const area = contained(decoded, current);
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(decoded.image, area.x, area.y, area.width, area.height);
        }
      } catch {
        if (ready.current?.generation === frame.metadata.generation) fail(activeT().localBrowser.imageFailed);
      } finally {
        decoded?.close();
        decoding = false;
        if (pending && !left && !failed) void draw();
      }
    };
    client.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (left || failed) return;
      if (typeof data === "string") {
        let value: unknown;
        try { value = JSON.parse(data); } catch { return fail(activeT().localBrowser.invalidMessage); }
        const descriptor = frameOf(value);
        if (descriptor) { frameMetadata = descriptor; return; }
        const next = readyOf(value);
        if (next) {
          if (ready.current?.generation !== next.generation) {
            pending = null;
            frameMetadata = null;
            heldPointer.current = null;
            heldKeys.current.clear();
            setCursor(null);
            canvas.current?.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
          }
          ready.current = next;
          setMetadata(next);
          if (!editingAddress.current) setAddress(next.url);
          clearTimeout(timeout);
          setState("live");
        } else if (typeof value === "object" && value !== null && "type" in value && value.type === "error") {
          const reason = "message" in value ? value.message : "error" in value ? value.error : "reason" in value ? value.reason : null;
          fail(typeof reason === "string" ? reason : activeT().localBrowser.reportedError);
        }
      } else if (ready.current && (data instanceof ArrayBuffer || data instanceof Blob)) {
        const current = ready.current;
        const metadata = frameMetadata ?? (current.tagged ? null : current);
        frameMetadata = null;
        if (!metadata || metadata.generation !== current.generation || metadata.width !== current.width || metadata.height !== current.height) return;
        pending = { blob: data instanceof Blob ? data : new Blob([data], { type: "image/jpeg" }), metadata };
        void draw();
      }
    };
    client.onerror = () => fail(activeT().localBrowser.connectionFailed);
    client.onclose = () => fail(activeT().localBrowser.connectionClosed);
    return () => {
      currentRelease.current();
      left = true;
      pending = null;
      clearTimeout(timeout);
      if (socket.current === client) { socket.current = null; ready.current = null; }
      client.close();
    };
  }, [url, attempt]);

  useEffect(() => {
    if (!interactive) { heldKeys.current.clear(); heldPointer.current = null; keyboard.current?.blur(); }
  }, [interactive]);
  useEffect(() => {
    const blurred = () => currentRelease.current();
    window.addEventListener("blur", blurred);
    return () => window.removeEventListener("blur", blurred);
  }, []);

  const fit = useRef(onFit);
  fit.current = onFit;
  useEffect(() => {
    const target = box.current;
    if (!target) return;
    let fitted: Size | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const { width, height } = target.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const view = { width: Math.max(1, Math.min(8000, Math.round(width))), height: Math.max(1, Math.min(8000, Math.round(height))) };
      setViewport(view);
      if (state !== "live" || !interactive || document.visibilityState === "hidden" || !changedViewport(view, fitted)) return;
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (!latest.current || document.visibilityState === "hidden") return;
        fitted = view;
        if (ready.current?.viewerFit) send({ type: "viewport", view });
        else fit.current(view);
      }, fitted === null ? 0 : 120);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    document.addEventListener("visibilitychange", measure);
    // Native viewers keep independent sizes; leaving a spectator must not reset another phone.
    return () => { observer.disconnect(); clearTimeout(settle); document.removeEventListener("visibilitychange", measure); };
  }, [state, interactive]);

  const point = (event: { clientX: number; clientY: number; button: number }): Point | null => {
    const target = canvas.current;
    const current = ready.current;
    if (!target || !current) return null;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      button: event.button >= 0 && event.button <= 2 ? event.button : heldPointer.current?.button ?? 0,
      generation: current.generation,
    };
  };
  const pointer = (action: "move" | "down" | "up", event: { clientX: number; clientY: number; button: number }) => {
    const at = point(event);
    if (!latest.current || !at) return;
    if (trackpad) setCursor({ x: at.x, y: at.y });
    if (action === "down") {
      heldPointer.current = at;
      if (!touch) keyboard.current?.focus({ preventScroll: true });
    }
    send({ type: "pointer", action, ...at });
    if (action === "up") heldPointer.current = null;
  };
  // A passive wheel listener would let the page scroll instead of the remote browser.
  const wheelSender = useRef<(event: WheelEvent) => void>(() => {});
  wheelSender.current = (event) => {
    if (!latest.current || !ready.current) return;
    event.preventDefault();
    const at = point(event);
    if (!at) return;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? ready.current.height : 1;
    send({ type: "wheel", x: at.x, y: at.y, deltaX: event.deltaX * scale, deltaY: event.deltaY * scale, generation: at.generation });
  };
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const wheel = (event: WheelEvent) => wheelSender.current(event);
    target.addEventListener("wheel", wheel, { passive: false });
    return () => target.removeEventListener("wheel", wheel);
  }, []);

  const commitText = () => {
    const field = keyboard.current;
    if (!field || composing.current) return;
    const text = field.value;
    field.value = "";
    if (text !== committedComposition.current) paste(text);
    committedComposition.current = null;
  };
  const navigate = () => {
    if (!interactive || state !== "live") return;
    try {
      const raw = address.trim();
      const target = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Unsupported address");
      send({ type: "navigate", url: target.href });
      setAddressProblem(null);
      editingAddress.current = false;
    } catch { setAddressProblem(t.localBrowser.addressInvalid); }
  };
  const size = metadata ?? initialSize;
  const scale = zoom ? 1 : viewport.width && viewport.height ? Math.min(viewport.width / size.width, viewport.height / size.height) : 1;
  const width = Math.max(1, size.width * scale);
  const height = Math.max(1, size.height * scale);
  const controls = interactive && touch && state === "live";
  const canNavigate = interactive && state === "live";

  return (
    <div className="remote-surface flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg-secondary)" }} onContextMenu={(event) => event.preventDefault()}>
      <form className="flex min-h-11 shrink-0 items-center gap-1 px-1.5 py-1" style={{ background: "var(--fill-primary)", borderBottom: "1px solid var(--fill-divider)" }}
        onSubmit={(event) => { event.preventDefault(); navigate(); }}>
        {([{ action: "back", label: t.common.back, icon: <ArrowLeft size={17} /> }, { action: "forward", label: t.localBrowser.forward, icon: <ArrowRight size={17} /> }, { action: "reload", label: t.localBrowser.reload, icon: <RotateCw size={16} /> }] as const).map(({ action, label, icon }) => (
          <button key={action} type="button" aria-label={label} disabled={!canNavigate} className="flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-35"
            style={{ color: "var(--icon-primary)", background: "var(--fill-secondary)" }} onClick={() => send({ type: "history", action })}>{icon}</button>
        ))}
        <input aria-label={t.localBrowser.address} type="text" inputMode="url" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
          readOnly={!canNavigate} value={address} placeholder={t.localBrowser.addressPlaceholder} title={metadata?.title || t.localBrowser.address}
          className="min-w-0 flex-1 rounded-full px-3 py-1.5 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--fill-outline)]"
          style={{ color: "var(--text-primary)", background: "var(--fill-secondary)", userSelect: "text" }}
          onChange={(event) => { setAddress(event.target.value); setAddressProblem(null); }}
          onFocus={() => { editingAddress.current = true; }} onBlur={() => { editingAddress.current = false; }} />
      </form>
      {addressProblem && <p role="alert" className="shrink-0 px-3 py-1 text-[12px]" style={{ color: "var(--fill-red)" }}>{addressProblem}</p>}
      <div className="relative min-h-0 flex-1" style={{ touchAction: "none" }}>
        <div ref={box} className="absolute inset-0" data-watching={interactive ? undefined : ""}>
          <div className="absolute inset-0 overflow-auto" style={{ scrollbarWidth: "none" }}>
            <div style={{ display: "grid", placeItems: "center", width: Math.max(viewport.width, width), height: Math.max(viewport.height, height) }}>
              <div className="relative" style={{ width, height }}>
              <canvas ref={canvas} tabIndex={interactive && !touch ? 0 : -1} aria-label={metadata?.title || t.localBrowser.page}
                style={{ display: "block", width, height, flexShrink: 0, outline: "none", cursor: interactive ? "default" : undefined }}
                onFocus={() => { if (interactive && !touch) keyboard.current?.focus({ preventScroll: true }); }}
                onPointerDown={(event) => {
                  if (!interactive || touch) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pointer("down", event);
                }}
                onPointerMove={(event) => { if (!touch) pointer("move", event); }}
                onPointerUp={(event) => { if (!touch) pointer("up", event); }}
                onPointerCancel={() => releaseInput()}
                onMouseDown={(event) => { if (!event.nativeEvent.isTrusted) pointer("down", event); }}
                onMouseMove={(event) => { if (!event.nativeEvent.isTrusted) pointer("move", event); }}
                onMouseUp={(event) => { if (!event.nativeEvent.isTrusted) pointer("up", event); }} />
              {controls && trackpad && cursor && <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                style={{ left: cursor.x * width, top: cursor.y * height, background: "var(--fill-blue)", boxShadow: "0 1px 4px #0008" }} />}
              </div>
            </div>
          </div>
          <textarea ref={keyboard} aria-label={t.viewer.typeIntoPage} tabIndex={-1} autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
            className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0" style={{ fontSize: 16 }}
            onBlur={releaseInput}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => {
              composing.current = false;
              const text = event.currentTarget.value || event.data;
              paste(text);
              event.currentTarget.value = "";
              committedComposition.current = text;
            }}
            onInput={(event) => { if (!(event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing)) commitText(); }}
            onPaste={(event) => { event.preventDefault(); paste(event.clipboardData.getData("text/plain")); event.currentTarget.value = ""; }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current || event.key === "Process" || event.key === "Dead" || event.key === "Unidentified") return;
              committedComposition.current = null;
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
              if ([...event.key].length === 1 && !event.ctrlKey && !event.metaKey && (!event.altKey || event.getModifierState("AltGraph"))) return;
              event.preventDefault();
              const key = { key: event.key, code: event.code };
              heldKeys.current.set(event.code || event.key, key);
              sendKey("down", key, modifiersOf(event));
            }}
            onKeyUp={(event) => {
              const id = event.code || event.key;
              const key = heldKeys.current.get(id);
              if (!key) return;
              event.preventDefault();
              heldKeys.current.delete(id);
              sendKey("up", key, modifiersOf(event));
            }} />
        </div>
        {state === "connecting" && <div className="skeleton absolute inset-0" aria-label={t.viewer.keyConnecting} />}
        {state === "failed" && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: "var(--bg-secondary)" }}>
          <p className="max-w-xs text-[14px]" style={{ color: "var(--text-secondary)" }}>{problem}</p>
          <button type="button" className="h-10 rounded-full px-5 text-[14px] font-semibold text-white" style={{ background: "var(--fill-blue)" }} onClick={() => setAttempt((value) => value + 1)}>{t.localBrowser.retry}</button>
        </div>}
        {controls && <TouchSurface screen={box} mode={trackpad ? "trackpad" : zoom ? "pan" : "touch"} />}
      </div>
      {controls && renderControls({ type, press, paste }, {
        trackpad, onTrackpad: () => { setTrackpad((value) => !value); setZoom(false); },
        zoom, onZoom: () => { setZoom((value) => !value); setTrackpad(false); },
      })}
    </div>
  );
}
