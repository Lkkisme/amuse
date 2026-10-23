import assert from "node:assert/strict";
import { test } from "node:test";
import { nextBox, pastePin, pinDigits } from "./pin-input.ts";

test("a PIN field keeps six digits, whatever is typed", () => {
  assert.equal(pinDigits("12 34-56"), "123456");
  assert.equal(pinDigits("1234567"), "123456");
  assert.equal(pinDigits("abc"), "");
  assert.equal(pinDigits(""), "");
});

test("a paste of a whole PIN fills the boxes, a shorter one is added to what is there", () => {
  assert.equal(pastePin("", "123456"), "123456");
  assert.equal(pastePin("", "your code is 123456"), "123456");
  assert.equal(pastePin("", "12"), "12");
  assert.equal(pastePin("1234", "56"), "123456");
  assert.equal(pastePin("1234", "ab"), "1234");
  assert.equal(pastePin("12", "123456"), "123456", "a whole PIN replaces what was there");
  assert.equal(pastePin("123456", "987654"), "987654");
  assert.equal(pastePin("123456", "12"), "123456", "and six digits is all there is room for");
});

test("the caret sits in the next empty box, and in the last one once they are full", () => {
  assert.equal(nextBox(""), 0);
  assert.equal(nextBox("12"), 2);
  assert.equal(nextBox("12345"), 5);
  assert.equal(nextBox("123456"), 5);
});
