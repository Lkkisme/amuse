import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./about.ts";

test("the setup is told as the server says it, and a failure in words without its details", async () => {
  assert.equal(await setup(async () => "Sandbox: on."), "Sandbox: on.");
  const failed = await setup(async () => {
    throw new Error("cannot read /data/keys.json");
  });
  assert.equal(failed, "The setup cannot be read just now.");
});
