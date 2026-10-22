import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

/** Every message by its dotted key, with its value. */
function messages(catalog: object, prefix = ""): [string, unknown][] {
  return Object.entries(catalog).flatMap(([key, value]): [string, unknown][] =>
    typeof value === "object" && value !== null
      ? messages(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

test("the Chinese catalog has every message the English one has", () => {
  assert.deepEqual(
    messages(zhCN).map(([key]) => key),
    messages(en).map(([key]) => key),
  );
});

test("every Chinese message is said: text is not empty, and a message that takes values says something for them", () => {
  const samples = [
    [0, "Sample"],
    [1, "Sample"],
    [5, "Sample"],
    ["Sample", "Sample"],
  ];
  for (const [key, value] of messages(zhCN)) {
    if (typeof value === "string") {
      assert.notEqual(value.trim(), "", key);
    } else if (typeof value === "function") {
      for (const args of samples) {
        const said: unknown = Reflect.apply(value, undefined, args);
        assert.equal(typeof said, "string", key);
        assert.notEqual(String(said).trim(), "", key);
      }
    } else {
      assert.fail(`${key} is neither text nor a function of values`);
    }
  }
});
