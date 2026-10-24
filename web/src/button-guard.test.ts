/**
 * Every text button in components/ is a `Button` (components/Button.tsx), and a
 * "are you sure?" sheet is a `ConfirmSheet`. This reads the sources and fails on
 * a new `<button` that gives itself a pill or a height, and on a danger `Button`
 * outside ConfirmSheet, so the look stays in one place.
 *
 * Left as `<button>` on purpose: icon-only buttons (they have an `aria-label`),
 * controls with their own role or pressed state (tabs, switches, menu items,
 * toggles), and list rows (neither a pill nor a height of their own).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const components = new URL("./components/", import.meta.url);
const sources = readdirSync(components)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: readFileSync(new URL(name, components), "utf8") }));

/** The opening tags of the `<button`s in a source, up to the `>` that closes each (past any `{…}`). */
function buttonTags(text: string): string[] {
  const tags: string[] = [];
  for (const start of text.matchAll(/<button\s/g)) {
    let depth = 0;
    let end = start.index;
    while (end < text.length) {
      const c = text.charAt(end);
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && text.charAt(end - 1) !== "=") break;
      end++;
    }
    tags.push(text.slice(start.index, end + 1));
  }
  return tags;
}

/** A `<button` that styles itself as a pill or a height: it should be a `Button`. */
function handStyled(tag: string): boolean {
  const ownLook = /rounded-full|rounded-\[|\bh-\d|\bh-\[/.test(tag);
  const control = /\saria-label=|\srole=|\saria-pressed=/.test(tag);
  return ownLook && !control;
}

/** Text buttons that are not `Button` on purpose, each with why (and each must still be there). */
const ALLOWED: { file: string; has: string; why: string }[] = [
  { file: "ChatFeed.tsx", has: "--chat-user-bubble", why: "a floating chip over the feed, in the bubbles' colours, not a control in a row or sheet" },
];

test("the scan tells a hand-styled text button from the rest", () => {
  assert.equal(handStyled('<button className="h-8 rounded-full px-4" onClick={go}>'), true);
  assert.equal(handStyled('<button className="rounded-full text-[14px]" style={{ color: "red" }}>'), true);
  assert.equal(handStyled('<button aria-label="Close" className="flex size-9 rounded-full">'), false);
  assert.equal(handStyled('<button role="tab" className="rounded-full">'), false);
  assert.equal(handStyled('<button aria-pressed={on} className="h-9 rounded-full">'), false);
  assert.equal(handStyled('<button className="flex w-full items-center gap-3 py-2.5 text-left">'), false);
  assert.deepEqual(buttonTags('<button className={x} onClick={() => a > b}>\n  Go\n</button>'), ['<button className={x} onClick={() => a > b}>']);
});

test("no text button is hand-styled outside Button", () => {
  const found = sources
    .filter(({ name }) => name !== "Button.tsx")
    .flatMap(({ name, text }) => buttonTags(text).filter(handStyled).map((tag) => ({ file: name, tag })));
  const unexplained = found.filter(({ file, tag }) => !ALLOWED.some((a) => a.file === file && tag.includes(a.has)));
  assert.deepEqual(
    unexplained.map(({ file, tag }) => `${file}: ${tag}`),
    [],
    "use <Button> (components/Button.tsx), or if it is an icon-only button, give it an aria-label",
  );
  for (const a of ALLOWED) {
    assert.equal(found.filter(({ file, tag }) => file === a.file && tag.includes(a.has)).length, 1, `${a.file} no longer has the button allowed for: ${a.why}`);
  }
});

test("a danger Button confirms in a ConfirmSheet", () => {
  const outside = sources.filter(({ name, text }) => name !== "ConfirmSheet.tsx" && /<Button[^>]*variant="danger"/s.test(text));
  assert.deepEqual(outside.map(({ name }) => name), [], "use <ConfirmSheet> (components/ConfirmSheet.tsx) for a sheet that asks first");
});
