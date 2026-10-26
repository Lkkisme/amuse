/**
 * The recording meter: thin bars scrolling right to left, one per level taken
 * (level.ts), drawn on a canvas with requestAnimationFrame. The newest bar is
 * at the right; between two samples the row slides, so it moves smoothly.
 * With reduced motion it is one bar in the middle that changes height.
 * `frozen` (while the recording is turned into text) stops it where it is.
 */
import { useEffect, useRef } from "react";
import { BARS, SAMPLE_MS } from "../level.ts";

/** What the meter draws: the bars, newest last, and when the last one was taken (performance.now). */
export interface Meter {
  bars: number[];
  at: number;
}

const BAR = 3;
const GAP = 3;
const PITCH = BAR + GAP;
const HEIGHT = 36;
/** A bar is never shorter than this, so silence is a dotted line rather than nothing. */
const LEAST = 3;

export function VoiceMeter({ meter, frozen }: { meter: Meter; frozen: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useRef(frozen);
  still.current = frozen;

  useEffect(() => {
    const el = canvas.current;
    const context = el?.getContext("2d");
    if (!el || !context) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let width = 0;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      width = el.clientWidth;
      el.width = Math.round(width * ratio);
      el.height = Math.round(HEIGHT * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const bar = (x: number, level: number, alpha: number) => {
      const h = LEAST + level * (HEIGHT - LEAST);
      context.globalAlpha = alpha;
      context.beginPath();
      context.roundRect(x, (HEIGHT - h) / 2, BAR, h, BAR / 2);
      context.fill();
    };
    const draw = () => {
      context.clearRect(0, 0, width, HEIGHT);
      context.fillStyle = getComputedStyle(el).color;
      const bars = meter.bars;
      if (calm.matches) {
        bar((width - BAR * 3) / 2, bars.at(-1) ?? 0, 1);
        bar((width - BAR * 3) / 2 + BAR, bars.at(-1) ?? 0, 1);
        bar((width - BAR * 3) / 2 + BAR * 2, bars.at(-1) ?? 0, 1);
      } else {
        // the row slides left by the part of a sample that has passed, then jumps back as the next bar arrives
        const slide = still.current ? 0 : Math.min(1, (performance.now() - meter.at) / SAMPLE_MS) * PITCH;
        const fits = Math.min(BARS, Math.ceil(width / PITCH) + 1);
        const shown = bars.slice(-fits);
        for (let i = 0; i < shown.length; i++) {
          const x = width - BAR - (shown.length - 1 - i) * PITCH + PITCH - slide;
          if (x < -BAR) continue;
          // the oldest fade out at the left edge
          const fade = Math.min(1, Math.max(0, x / 24));
          bar(x, shown[i] ?? 0, fade);
        }
      }
      if (!still.current) frame = requestAnimationFrame(draw);
    };
    const redraw = () => {
      cancelAnimationFrame(frame);
      fit();
      draw();
    };
    redraw();
    const resize = new ResizeObserver(redraw);
    resize.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [meter, frozen]);

  return <canvas ref={canvas} aria-hidden className="block min-w-0 flex-1" style={{ height: HEIGHT, color: "var(--fill-blue)", opacity: frozen ? 0.35 : 1, transition: "opacity 200ms" }} />;
}
