import assert from "node:assert/strict";
import { test } from "node:test";
import { markPrefix } from "./cache.ts";

const mark = { type: "ephemeral" };
const parts = ["header\n\nline 1\nline 2\n", "line 3\nline 4\n"];
const stable = parts.join("");
const tail = "\n---\nNow: noon.";

/** A request as Pi sends it to Anthropic: the system prompt, the last tool and the last message marked. */
const anthropic = (content: unknown) => ({
  model: "m",
  system: [{ type: "text", text: "rules", cache_control: mark }],
  tools: [{ name: "a" }, { name: "b", cache_control: mark }],
  messages: [{ role: "user", content }],
});

test("the first message is cut after the parts that hold still, and the last of them is marked", () => {
  // with one message, Pi marks the end of its text
  const sent = anthropic([{ type: "text", text: stable + tail, cache_control: mark }]);
  assert.deepEqual(markPrefix(sent, parts), {
    ...sent,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: parts[0] },
          { type: "text", text: parts[1], cache_control: mark },
          { type: "text", text: tail, cache_control: mark },
        ],
      },
    ],
  });
});

test("a message sent as a string is cut too, and the pictures that follow its text stay as they are", () => {
  const picture = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
  const cut = markPrefix(anthropic(stable + tail), parts);
  assert.ok(cut !== null && typeof cut === "object" && "messages" in cut && Array.isArray(cut.messages));
  assert.deepEqual(cut.messages[0].content.map((b: { text: string }) => b.text), [parts[0], parts[1], tail]);
  const withPicture = markPrefix(anthropic([{ type: "text", text: stable + tail }, picture]), parts);
  assert.ok(withPicture !== null && typeof withPicture === "object" && "messages" in withPicture && Array.isArray(withPicture.messages));
  assert.equal(withPicture.messages[0].content.at(-1), picture);
  assert.equal(withPicture.messages[0].content.length, 4);
});

test("only the first user message is cut, and a request is not changed otherwise", () => {
  const later = { ...anthropic(stable + tail), messages: [{ role: "user", content: stable + tail }, { role: "assistant", content: "ok" }, { role: "user", content: "again" }] };
  const cut = markPrefix(later, parts);
  assert.ok(cut !== null && typeof cut === "object" && "messages" in cut && Array.isArray(cut.messages));
  assert.equal(cut.messages.length, 3);
  assert.deepEqual(cut.messages.slice(1), later.messages.slice(1));
});

test("a request that is not marked for caching, or has no mark to spare, or does not begin with the parts, is left as it is", () => {
  const plain = { model: "gpt", messages: [{ role: "user", content: stable + tail }] };
  assert.equal(markPrefix(plain, parts), plain, "OpenAI caches by prefix by itself");
  const full = { ...anthropic(stable + tail), system: [{ type: "text", text: "a", cache_control: mark }, { type: "text", text: "b", cache_control: mark }], tools: [{ name: "x", cache_control: mark }, { name: "y", cache_control: mark }] };
  assert.equal(markPrefix(full, parts), full, "four marks is the most Anthropic takes");
  const other = anthropic("a different message");
  assert.equal(markPrefix(other, parts), other);
  const unparted = anthropic(stable + tail);
  assert.equal(markPrefix(unparted, []), unparted, "no part has closed yet");
  const whole = anthropic(stable);
  assert.equal(markPrefix(whole, parts), whole, "nothing after the parts: the end is marked already");
  for (const odd of [null, "text", 3, { messages: "no" }, { messages: [] }]) assert.equal(markPrefix(odd, parts), odd);
});

test("OpenRouter's format for Anthropic models is cut the same way", () => {
  const sent = {
    model: "anthropic/claude",
    messages: [
      { role: "system", content: [{ type: "text", text: "rules", cache_control: mark }] },
      { role: "user", content: [{ type: "text", text: stable + tail, cache_control: mark }] },
    ],
    tools: [{ type: "function", cache_control: mark }],
  };
  const cut = markPrefix(sent, parts);
  assert.ok(cut !== null && typeof cut === "object" && "messages" in cut && Array.isArray(cut.messages));
  assert.deepEqual(cut.messages[1].content.map((b: { text: string }) => b.text), [parts[0], parts[1], tail]);
  assert.deepEqual(cut.messages[0], sent.messages[0]);
});
