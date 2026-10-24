import assert from "node:assert/strict";
import { test } from "node:test";
import { continued } from "./agent.ts";

test("a run that fails in a lane is said in words and dropped; the lane goes on, and nothing is left rejected", async () => {
  const said: string[] = [];
  const ran: string[] = [];
  let queue: Promise<void> = Promise.resolve();
  queue = continued(queue, "c-1", async () => void ran.push("first"), (m) => void said.push(m));
  queue = continued(queue, "c-1", async () => {
    throw new Error("FOREIGN KEY constraint failed");
  }, (m) => void said.push(m));
  queue = continued(queue, "c-1", async () => void ran.push("third"), (m) => void said.push(m));
  await queue; // would reject (and, unhandled, end the process) if the failure were left in the chain
  assert.deepEqual(ran, ["first", "third"]);
  assert.equal(said.length, 1);
  assert.match(said[0] ?? "", /a turn in the chat c-1 ended with an error and was dropped: FOREIGN KEY constraint failed/);
});
