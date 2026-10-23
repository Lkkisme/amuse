import assert from "node:assert/strict";
import { test } from "node:test";
import { CallFailed } from "@amuse/api/client";
import { type Session, errors, parseResult } from "@amuse/protocol";
import { describeDevice } from "./device.ts";
import { type Need, type Said, needOf, pinGuarded, withPin } from "./pin.ts";

/** A session whose first answers are the failures given, then a result. */
function failing(...failures: Error[]): Session & { tries: () => number } {
  let tries = 0;
  return {
    async call(method) {
      tries++;
      const failure = failures.shift();
      if (failure) throw failure;
      return parseResult[method](method === "chats.list" ? { chats: [] } : null);
    },
    subscribe: () => () => {},
    tries: () => tries,
  };
}

test("a call the server holds for the PIN asks for it, then goes again once; any other failure is the caller's", async () => {
  const asked: Need[] = [];
  const locked = failing(new CallFailed(errors.pinLocked.message, errors.pinLocked.code));
  const guarded = pinGuarded(locked, async (need) => (asked.push(need), true));
  assert.deepEqual(await guarded.call("chats.list", {}), { chats: [] });
  assert.deepEqual(asked, ["locked"]);
  assert.equal(locked.tries(), 2);

  // let be: the call fails as it would have
  const unset = failing(new CallFailed(errors.pinUnset.message, errors.pinUnset.code));
  await assert.rejects(pinGuarded(unset, async (need) => (asked.push(need), false)).call("chats.list", {}), /Set a PIN first/);
  assert.deepEqual(asked, ["locked", "unset"]);
  assert.equal(unset.tries(), 1);

  const other = failing(new CallFailed("Composio could not be reached", -32000));
  await assert.rejects(pinGuarded(other, async () => assert.fail("not a PIN's")).call("chats.list", {}), /Composio/);
  assert.equal(needOf(new Error("disconnected")), null);
});

test("an account request the PIN holds is asked for and tried again, once", async () => {
  const held: Said = { ok: false, reason: "Enter your PIN to do this.", pin: "locked", left: null, until: null };
  const answers: Said[] = [held, { ok: true }];
  assert.deepEqual(await withPin(async () => true, async () => answers.shift() ?? held), { ok: true });
  assert.deepEqual(await withPin(async () => false, async () => held), held);
});

test("a device is told apart by what it is and its browser", () => {
  const cases: [string, string, string][] = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "iPhone · Safari", "phone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1", "iPhone · Chrome", "phone"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36", "Android · Chrome", "phone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", "Mac · Chrome", "computer"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0", "Windows · Edge", "computer"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Linux · Firefox", "computer"],
    ["", "", "computer"],
  ];
  for (const [agent, name, kind] of cases) assert.deepEqual(describeDevice(agent), { name, kind }, agent);
});
