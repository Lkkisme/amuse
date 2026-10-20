/**
 * Fingers on the live desktop, read as phone gestures (touch-gestures.ts)
 * and played to noVNC as ordinary mouse and wheel events on its canvas, so
 * its own scaling maps them onto the desktop. noVNC's own touch handling
 * never sees a finger: it reads a slide as a mouse drag and a long press as
 * the right button.
 *
 * A finger held still arms a drag: a four-way arrow shows above it (and a
 * short buzz where phones allow), and moving drags with the button down.
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import { Move } from "lucide-react";
import { HOLD, type Hint, type Input, type Mode, type Output, initial, step } from "../touch-gestures.ts";

export function TouchSurface({ screen, mode }: { screen: RefObject<HTMLDivElement | null>; mode: Mode }) {
  const layer = useRef<HTMLDivElement>(null);
  const state = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hint, setHint] = useState<Hint>({ kind: "none" });

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    state.current = initial; // a mode change starts over
  }, [mode]);

  const canvas = () => screen.current?.querySelector("canvas") ?? null;

  const perform = (output: Output, target: HTMLCanvasElement) => {
    const mouse = (kind: "mousemove" | "mousedown" | "mouseup", at: { x: number; y: number }, down: boolean) => {
      // while noVNC holds the mouse after a press, the release goes to its capture element
      const capture = document.getElementById("noVNC_mouse_capture_elem");
      const to = kind === "mouseup" && capture && capture.style.display !== "none" ? capture : target;
      to.dispatchEvent(new MouseEvent(kind, { clientX: at.x, clientY: at.y, buttons: down ? 1 : 0, bubbles: true }));
    };
    switch (output.kind) {
      case "point":
        return mouse("mousemove", output.at, output.down);
      case "press":
        return mouse("mousedown", output.at, true);
      case "release":
        return mouse("mouseup", output.at, false);
      case "scroll": {
        // the page moves with the fingers: their travel in desktop pixels, as wheel travel the other way
        const scale = target.width / target.getBoundingClientRect().width;
        const wheel = { deltaX: -output.by.x * scale, deltaY: -output.by.y * scale, deltaMode: 0 };
        target.dispatchEvent(new WheelEvent("wheel", { clientX: output.at.x, clientY: output.at.y, bubbles: true, ...wheel }));
        return;
      }
      case "pan": {
        // actual size: noVNC's screen scrolls over the full-size desktop
        const view = screen.current?.firstElementChild;
        if (view instanceof HTMLElement) view.scrollBy(-output.by.x, -output.by.y);
        return;
      }
      case "hint":
        return setHint(output.hint);
    }
  };

  const feed = (input: Input) => {
    const target = canvas();
    const view = screen.current?.getBoundingClientRect();
    if (!target || !view) return;
    const c = target.getBoundingClientRect();
    // the part of the desktop on screen (at actual size, the canvas is bigger than the view)
    const bounds = { left: Math.max(c.left, view.left), top: Math.max(c.top, view.top), right: Math.min(c.right, view.right), bottom: Math.min(c.bottom, view.bottom) };
    const wasPending = state.current.phase.kind === "pending";
    const [next, outputs] = step(state.current, input, mode, bounds);
    state.current = next;
    if (next.phase.kind !== "pending") clearTimeout(timer.current);
    else if (!wasPending) timer.current = setTimeout(() => feed({ kind: "held" }), HOLD);
    if (wasPending && next.phase.kind === "armed") navigator.vibrate?.(12); // the drag is armed
    for (const output of outputs) perform(output, target);
  };

  const point = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY });
  const origin = layer.current?.getBoundingClientRect();
  const place = (p: { x: number; y: number }) => ({ left: p.x - (origin?.left ?? 0), top: p.y - (origin?.top ?? 0) });

  return (
    <div
      ref={layer}
      className="absolute inset-0"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        feed({ kind: "down", id: e.pointerId, at: point(e) });
      }}
      onPointerMove={(e) => feed({ kind: "move", id: e.pointerId, at: point(e) })}
      onPointerUp={(e) => feed({ kind: "up", id: e.pointerId })}
      onPointerCancel={(e) => feed({ kind: "up", id: e.pointerId })}
    >
      {hint.kind === "armed" && <DragHint at={place(hint.at)} />}
    </div>
  );
}

/** Above the armed finger, where it can be seen: a four-way arrow, saying moves now drag. */
function DragHint({ at }: { at: { left: number; top: number } }) {
  return (
    <span
      className="anim-popover-in pointer-events-none absolute flex size-11 -translate-x-1/2 items-center justify-center rounded-full"
      style={{ left: at.left, top: at.top - 74, background: "var(--fill-blue)", color: "#fff", boxShadow: "var(--shadow-raised)" }}
    >
      <Move size={22} />
    </span>
  );
}
