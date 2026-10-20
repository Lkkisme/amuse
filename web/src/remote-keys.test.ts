import assert from "node:assert/strict";
import { test } from "node:test";
import { FILLER, edit, keys, runs } from "./remote-keys.ts";

test("typing adds text; backspace past the filler's end deletes", () => {
  assert.deepEqual(edit(FILLER, `${FILLER}hi`), { backspaces: 0, text: "hi" });
  assert.deepEqual(edit(FILLER, FILLER.slice(0, -1)), { backspaces: 1, text: "" });
});

test("an autocorrect or IME commit replaces what it changed", () => {
  assert.deepEqual(edit(`${FILLER}teh`, `${FILLER}the `), { backspaces: 2, text: "he " });
  assert.deepEqual(edit(FILLER, `${FILLER}你好`), { backspaces: 0, text: "你好" });
});

test("ASCII goes as keys, the rest by paste, in order", () => {
  assert.deepEqual(runs("ok 你好!\n"), [
    { kind: "keys", syms: [0x6f, 0x6b, 0x20] },
    { kind: "paste", text: "你好" },
    { kind: "keys", syms: [0x21, keys.Enter] },
  ]);
});
