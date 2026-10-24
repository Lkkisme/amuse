/**
 * Nothing sizes itself with a height viewport unit alone. The Android app's WebView
 * reports 0 for `vh`, `dvh`, `svh` and `lvh` (the width ones are right), so a bare
 * `max-h-[92vh]` computed to `max-height: 0px` and every bottom sheet collapsed: the
 * backdrop dimmed the page and no sheet appeared. Where a height unit is used it is
 * paired with a percentage of the full-height layer around it, which is the same height
 * in a browser — a layer inset to 0 is never taller than the large viewport `vh` is.
 * This reads the sources, so a new one is caught here rather than on a phone.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const here = new URL("./", import.meta.url);
const sources = readdirSync(here, { recursive: true, encoding: "utf8" })
  .filter((name) => /\.(tsx|ts|css)$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => ({ name, text: readFileSync(new URL(name, here), "utf8") }));

/** `92vh`, `100dvh`, `50svh`, `10lvh` — the height ones, never `vw`/`dvw`. */
const HEIGHT_UNIT = /(?<![\w-])\d*\.?\d+(?:vh|dvh|svh|lvh)(?![\w-])/g;

/** What a height unit is written in: the Tailwind value `[ … ]` around it, else its whole line. */
export function scopeAround(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const at = index - lineStart;
  const open = line.lastIndexOf("[", at);
  const close = line.indexOf("]", at);
  if (open !== -1 && close !== -1 && !line.slice(open, at).includes("]")) return line.slice(open + 1, close);
  return line;
}

test("scopeAround reads a Tailwind value, or the line it is on", () => {
  const className = 'className="relative max-h-[max(92vh,92%)] w-full"';
  assert.equal(scopeAround(className, className.indexOf("92vh")), "max(92vh,92%)");
  const bare = 'className="relative max-h-[92vh] w-full"';
  assert.equal(scopeAround(bare, bare.indexOf("92vh")), "92vh");
  const css = "  height: 100vh; /* the panel */";
  assert.equal(scopeAround(css, css.indexOf("100vh")), css);
});

test("a height viewport unit is never the only height", () => {
  const offenders: string[] = [];
  for (const { name, text } of sources) {
    for (const match of text.matchAll(HEIGHT_UNIT)) {
      const scope = scopeAround(text, match.index);
      if (!scope.includes("%")) offenders.push(`${name}: ${scope.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "pair it with a percentage of the full-height layer around it: the Android WebView reports 0 for vh",
  );
});
