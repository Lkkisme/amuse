import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

/** Every message by its dotted key, with its value. */
function messages(catalog: object, prefix = ""): [string, unknown][] {
  return Object.entries(catalog).flatMap(([key, value]): [string, unknown][] =>
    typeof value === "object" && value !== null ? messages(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );
}

/** Sample values for each message that takes values, by its key: the kinds of value the English one takes. */
const samples: Record<string, unknown[]> = {
  "time.today": ["8:00"],
  "time.tomorrow": ["8:00"],
  "time.yesterday": ["8:00"],
  "time.onDay": ["Fri, Oct 23", "8:00"],
  "schedule.once": ["Fri, Oct 23, 8:00"],
  "schedule.everyDayAt": ["03:00"],
  "schedule.state.next": ["Tomorrow, 8:00"],
  "schedule.lastRun": ["Today, 8:00", "Reported", "Sample summary"],
  "connections.noMatch": ["Sample"],
  "connections.optionsFor": ["Sample"],
  "connections.kindLines.read": ["Sample"],
  "connections.kindLines.write": ["Sample"],
  "connections.kindLines.destructive": ["Sample"],
  "keys.keyHint": ["ak_1234"],
  "models.modelFor": ["Chat"],
  "models.thinkingFor": ["Chat"],
  "models.usedFor": [["chat", "the browser"]],
  "logins.signOutOf": ["example.com"],
  "sandbox.deliverEnv": ["API_KEY"],
  "sandbox.deliverFile": [".config/tool/token"],
  "sandbox.deliverPane": ["1"],
  "sandbox.removeTitle": ["Sample key"],
  "permissions.notAddress": ["not a site"],
  "permissions.pair": ["Visit", "Allow"],
  "explainer.dataTitle": ["Sample app"],
  "explainer.dataBody": ["Sample app"],
  "chat.openFile": ["photo.png"],
  "chat.newMessages": [2],
  "chat.messageIn": ["Side chat"],
  "chat.removeFile": ["photo.png"],
  "chat.notSent": ["Sample reason"],
  "viewer.browserWith": ["Working"],
  "cards.destinationEnv": ["API_KEY"],
  "cards.destinationFile": [".config/tool/token"],
  "cards.destinationPane": ["1"],
  "cards.scheduleLabel": ["Sample schedule"],
};

test("the Chinese catalog has every message the English one has", () => {
  assert.deepEqual(
    messages(zhCN).map(([key]) => key),
    messages(en).map(([key]) => key),
  );
});

test("every Chinese message is said: text is not empty, and a message that takes values says something for it", () => {
  for (const [key, value] of messages(zhCN)) {
    if (typeof value === "string") {
      assert.notEqual(value.trim(), "", key);
    } else if (typeof value === "function") {
      const args = samples[key];
      if (!args) assert.fail(`${key} takes values: add sample values for it to this test`);
      const said: unknown = Reflect.apply(value, undefined, args);
      assert.equal(typeof said, "string", key);
      assert.notEqual(String(said).trim(), "", key);
    } else {
      assert.fail(`${key} is neither text nor a function of values`);
    }
  }
});
