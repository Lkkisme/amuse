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
  "sidebar.noMatch": ["Sample"],
  "sidebar.optionsFor": ["Sample chat"],
  "sidebar.ago.minutes": [5],
  "sidebar.ago.hours": [3],
  "sidebar.ago.days": [2],
  "goals.doneOn": ["Oct 21"],
  "goals.latestNote": ["Oct 21", "A note"],
  "goals.added": ["Oct 21"],
  "goals.startedOn": ["Oct 21"],
  "goals.sinceDay": ["Oct 21"],
  "skills.removeTitle": ["Sample skill"],
  "skills.installMessage": ["a sample"],
};

test("the Chinese catalog has every message the English one has", () => {
  assert.deepEqual(
    messages(zhCN).map(([key]) => key),
    messages(en).map(([key]) => key),
  );
});

test("every Chinese message is said: text is not empty, and a message that takes values says something for it", () => {
  const unsampled = messages(zhCN)
    .filter(([key, value]) => typeof value === "function" && !samples[key])
    .map(([key]) => key);
  assert.deepEqual(unsampled, [], "these take values: add sample values for them to this test");
  for (const [key, value] of messages(zhCN)) {
    if (typeof value === "string") {
      assert.notEqual(value.trim(), "", key);
    } else if (typeof value === "function") {
      const said: unknown = Reflect.apply(value, undefined, samples[key] ?? []);
      assert.equal(typeof said, "string", key);
      assert.notEqual(String(said).trim(), "", key);
    } else {
      assert.fail(`${key} is neither text nor a function of values`);
    }
  }
});
