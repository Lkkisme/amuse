/**
 * A browser run's live page: JPEG frames drawn on a canvas, and — while the
 * user is in control — pointer, wheel and keyboard input sent back as
 * protocol Input with coordinates as fractions of the frame. Text from
 * mobile keyboards and IMEs goes through a hidden input as committed text.
 */
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { type Input, Screen } from "@remuse/protocol";

/** Keys sent as key presses; anything else that is one character is typed as text. */
const namedKeys = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

export function LiveView({ url, interactive, onScreen }: { url: string; interactive: boolean; onScreen: (screen: Screen) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const typing = useRef<HTMLInputElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "gone">("connecting");
  // the latest callback, so a new parent render does not reconnect the stream
  const screenTo = useRef(onScreen);
  screenTo.current = onScreen;

  useEffect(() => {
    const ws = new WebSocket(url);
    ws.binaryType = "blob";
    socket.current = ws;
    ws.onmessage = async ({ data }) => {
      if (data instanceof Blob) {
        const frame = await createImageBitmap(data);
        const c = canvas.current;
        const g = c?.getContext("2d");
        if (!c || !g) return frame.close();
        if (c.width !== frame.width || c.height !== frame.height) {
          c.width = frame.width;
          c.height = frame.height;
        }
        g.drawImage(frame, 0, 0);
        frame.close();
        setState("live");
      } else if (typeof data === "string") {
        const screen = Screen.safeParse(JSON.parse(data));
        if (screen.success) screenTo.current(screen.data);
      }
    };
    ws.onclose = () => setState("gone");
    return () => ws.close();
  }, [url]);

  const send = (input: Input) => {
    if (interactive && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(input));
  };

  /** Pointer position as fractions of the drawn frame (the canvas is letterboxed by object-fit). */
  const at = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current;
    if (!c || !c.width) return null;
    const box = c.getBoundingClientRect();
    const scale = Math.min(box.width / c.width, box.height / c.height);
    const w = c.width * scale;
    const h = c.height * scale;
    const x = (e.clientX - box.left - (box.width - w) / 2) / w;
    const y = (e.clientY - box.top - (box.height - h) / 2) / h;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const button = (b: number) => (b === 1 ? "middle" : b === 2 ? "right" : "left");
  const pointer = (action: "down" | "up" | "move") => (e: React.PointerEvent) => {
    const p = at(e);
    if (p) send({ kind: "pointer", action, ...p, button: button(e.button) });
  };

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ background: "var(--bg-secondary)" }}>
      <canvas
        ref={canvas}
        tabIndex={interactive ? 0 : -1}
        className="h-full w-full object-contain outline-none"
        style={{ touchAction: interactive ? "none" : "auto", cursor: interactive ? "default" : "not-allowed" }}
        onPointerDown={(e) => {
          e.currentTarget.focus();
          pointer("down")(e);
        }}
        onPointerUp={pointer("up")}
        onPointerMove={(e) => e.buttons && pointer("move")(e)}
        onWheel={(e) => {
          const p = at(e);
          if (p) send({ kind: "wheel", ...p, dx: e.deltaX, dy: e.deltaY });
        }}
        onKeyDown={(e) => {
          if (!interactive) return;
          e.preventDefault();
          if (namedKeys.has(e.key)) send({ kind: "key", action: "down", key: e.key });
          else if (e.key.length === 1) send({ kind: "text", text: e.key });
        }}
        onKeyUp={(e) => {
          if (interactive && namedKeys.has(e.key)) send({ kind: "key", action: "up", key: e.key });
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {interactive && (
        <>
          {/* phones: a hidden input brings up the keyboard; whatever it commits is typed into the page */}
          <input
            ref={typing}
            aria-label="Type into the page"
            className="absolute bottom-0 left-0 size-px opacity-0"
            onInput={(e) => {
              const text = e.currentTarget.value;
              if (text) send({ kind: "text", text });
              e.currentTarget.value = "";
            }}
            onKeyDown={(e) => {
              if (namedKeys.has(e.key)) send({ kind: "key", action: "down", key: e.key });
            }}
            onKeyUp={(e) => {
              if (namedKeys.has(e.key)) send({ kind: "key", action: "up", key: e.key });
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
