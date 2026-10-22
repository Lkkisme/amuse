import assert from "node:assert/strict";
import { test } from "node:test";
import { Clip } from "./output.ts";

test("the first and the last of output are kept, with what was left out counted", () => {
  const clip = new Clip(5, 10);
  clip.append("abcdefghij");
  assert.deepEqual(clip.result(), { output: "abcdefghij", cut: 0 });
  clip.append("0123456789".repeat(100));
  const { output, cut } = clip.result();
  assert.ok(output.startsWith("abcde\n… "), output);
  assert.ok(output.endsWith("\n0123456789"), output);
  assert.equal(cut, 10 + 1000 - 5 - 10);
});
