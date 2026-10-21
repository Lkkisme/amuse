import assert from "node:assert/strict";
import { test } from "node:test";
import { Clip, MOST_BYTES, endOf, lastLines } from "./output.ts";

test("the first and the last of output are kept, with what was left out counted", () => {
  const clip = new Clip(5, 10);
  clip.append("abcdefghij");
  assert.deepEqual(clip.result(), { output: "abcdefghij", cut: 0 });
  clip.append("0123456789".repeat(100));
  const { output, cut } = clip.result();
  assert.ok(output.startsWith("abcde\n… "), output);
  assert.ok(output.endsWith("\n0123456789"), output);
  assert.equal(cut, 10 + 1000 - 5 - 10);
  assert.equal(lastLines("a\nb\nc\n", 2), "b\nc");
});

test("text is cut to what fits in bytes as JSON, from the front, whatever it is made of", () => {
  assert.equal(endOf("short"), "short");
  // control characters take six bytes each once escaped, and CJK three
  for (const unit of ["\u0000", "\u001b", "猫", "😀", "a", '"']) {
    const text = unit.repeat(500_000);
    const kept = endOf(text);
    assert.ok(Buffer.byteLength(JSON.stringify(kept)) <= MOST_BYTES, unit);
    assert.ok(text.endsWith(kept), "the end is what is kept");
    assert.ok(Buffer.byteLength(JSON.stringify(kept)) > MOST_BYTES - 16, `${unit}: not cut more than it must`);
  }
  assert.ok(MOST_BYTES < 1024 ** 2 / 2, "well under what the client reads");
});
