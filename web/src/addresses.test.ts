import assert from "node:assert/strict";
import { test } from "node:test";
import { addressesIn } from "./addresses.ts";

const found = (text: string) => addressesIn(text).map((a) => a.address);

test("web addresses are found in running text, without the punctuation or the sentence after them", () => {
  assert.deepEqual(
    found(
      "链接在这：https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c&scope=org%3Acreate 你打开后",
    ),
    [
      "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c&scope=org%3Acreate",
    ],
  );
  assert.deepEqual(
    found(
      "See https://example.com/a. Then https://example.org/b, and (https://x.io/c).",
    ),
    ["https://example.com/a", "https://example.org/b", "https://x.io/c"],
  );
  assert.deepEqual(found("打开https://example.com，然后"), [
    "https://example.com",
  ]);
  // a bracket the address opened is its own
  assert.deepEqual(found("https://en.wikipedia.org/wiki/Mercury_(planet)!"), [
    "https://en.wikipedia.org/wiki/Mercury_(planet)",
  ]);
  assert.deepEqual(
    found("no address here, nor http:// alone, nor ftp://x.org"),
    [],
  );
  assert.equal(addressesIn("go to https://a.b/c now")[0]?.at, 6);
});
