/**
 * Turning what a phone keyboard commits into what the remote desktop gets.
 * The phone types into a hidden field that always holds a run of filler, so
 * a backspace has something to delete; each change is read as "delete n,
 * then add this text" against the filler. Plain ASCII is typed as keys;
 * anything else (Chinese, emoji) goes over by paste, which every page takes.
 */

/** What the hidden field holds between edits. */
export const FILLER = "_".repeat(64);

export type Edit = { backspaces: number; text: string };

/** The edit that turns `before` into `after`, both read up to the caret (the end). */
export function edit(before: string, after: string): Edit {
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same++;
  return { backspaces: before.length - same, text: after.slice(same) };
}

/** X keysyms for the keys the key bar and typing need. */
export const keys = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  Control: 0xffe3,
  Meta: 0xffe7,
  Super: 0xffeb,
  V: 0x76,
} as const;

/** Printable ASCII is its own keysym; newline is Enter. Null: send it by paste. */
export function keysym(char: string): number | null {
  if (char === "\n") return keys.Enter;
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code < 0x7f ? code : null;
}

/** Text split into runs to type as keys and runs to paste, in order. */
export function runs(text: string): ({ kind: "keys"; syms: number[] } | { kind: "paste"; text: string })[] {
  const out: ({ kind: "keys"; syms: number[] } | { kind: "paste"; text: string })[] = [];
  for (const char of text) {
    const sym = keysym(char);
    const last = out.at(-1);
    if (sym !== null) {
      if (last?.kind === "keys") last.syms.push(sym);
      else out.push({ kind: "keys", syms: [sym] });
    } else if (last?.kind === "paste") last.text += char;
    else out.push({ kind: "paste", text: char });
  }
  return out;
}
