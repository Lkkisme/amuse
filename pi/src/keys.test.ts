import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileCredentials } from "./credentials.ts";
import { bare, piKeys, plainly } from "./keys.ts";

const composio = {
  id: "composio",
  name: "Composio",
  message: "Enter your Composio API key",
  where: "On composio.dev.",
  link: {
    url: "https://composio.dev/",
    label: "composio.dev",
  },
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const path = join(dir, "keys.json");
  const keys = piKeys({
    keys: fileCredentials(path),
    choicePath: join(dir, "models.json"),
    apps: [composio],
  });
  return { dir, path, keys };
}

test("a provider's key is set up through its own prompts, kept owner-only, and shown only by its end", async () => {
  const { path, keys } = setup();
  let changes = 0;
  keys.onChange(() => changes++);
  const first = await keys.login("fireworks");
  assert.equal(first.kind, "prompt");
  if (first.kind !== "prompt") return;
  assert.equal(first.prompt.type, "secret");
  assert.deepEqual(await keys.answer(first.login, "fw_secret_key_1234"), {
    kind: "done",
  });
  assert.equal(changes, 1);

  const listed = await keys.list();
  const fireworks = listed.providers.find((p) => p.id === "fireworks");
  assert.deepEqual(fireworks, {
    id: "fireworks",
    name: fireworks?.name,
    use: "models",
    connected: true,
    hint: "…1234",
  });
  assert.ok(!JSON.stringify(listed).includes("fw_secret_key_1234"), "the key never comes back");
  assert.ok(listed.models.length > 0 && listed.models.every((m) => m.provider === "fireworks"));
  assert.equal(statSync(path).mode & 0o777, 0o600);

  // a sign-in answered once is over
  assert.equal((await keys.answer(first.login, "again")).kind, "failed");
});

test("models are chosen among those offered; the browser's must see pictures; forgetting the key lets go of them", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "fw_secret_key_1234");
  const { models } = await keys.list();
  const seeing = models.find((m) => m.images);
  const blind = models.find((m) => !m.images);
  assert.ok(seeing && blind);

  await assert.rejects(keys.choose("chat", "nowhere/model"));
  await keys.choose("chat", blind.id);
  await assert.rejects(keys.choose("browser", blind.id), /pictures/);
  await keys.choose("browser", seeing.id);
  assert.equal(keys.model("chat"), blind.id);
  assert.equal(keys.model("browser"), seeing.id);

  await keys.logout("fireworks");
  assert.equal(keys.model("chat"), null);
  assert.equal(keys.model("browser"), null);
  const after = await keys.list();
  assert.equal(after.providers.find((p) => p.id === "fireworks")?.connected, false);
  assert.deepEqual(after.models, []);
});

test("an app's key is asked for with where to get it, and read back by the server only", async () => {
  const { dir, keys } = setup();
  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  assert.equal(first.notes[0]?.links[0]?.url, composio.link.url);
  assert.deepEqual(await keys.answer(first.login, "  ak_composio_5678 "), {
    kind: "done",
  });
  assert.equal(keys.appKey("composio"), "ak_composio_5678");
  assert.equal((await keys.list()).providers[0]?.hint, "…5678");

  // kept across restarts
  const again = piKeys({
    keys: fileCredentials(join(dir, "keys.json")),
    choicePath: join(dir, "models.json"),
    apps: [composio],
  });
  await again.list();
  assert.equal(again.appKey("composio"), "ak_composio_5678");
  assert.ok(readFileSync(join(dir, "keys.json"), "utf8").includes("ak_composio_5678"));
});

test("a sign-in can be stopped, and an unknown provider is refused", async () => {
  const { keys } = setup();
  const first = await keys.login("fireworks");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.cancel(first.login);
  assert.equal((await keys.answer(first.login, "late")).kind, "failed");
  assert.equal((await keys.list()).providers.find((p) => p.id === "fireworks")?.connected, false);
  assert.equal((await keys.login("no-such-provider")).kind, "failed");
});

test("a key is tried on request: none set up says so; an app's test says how it went, never echoing the key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  let works = true;
  const keys = piKeys({
    keys: fileCredentials(join(dir, "keys.json")),
    choicePath: join(dir, "models.json"),
    apps: [
      {
        ...composio,
        test: async (key) => {
          if (!works) throw new Error(`401 Unauthorized for ${key}`);
        },
      },
    ],
  });
  assert.deepEqual(await keys.test("fireworks"), { ok: false, detail: "No key is set up." });
  assert.deepEqual(await keys.test("composio"), { ok: false, detail: "No key is set up." });

  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "ak_composio_5678");
  assert.deepEqual(await keys.test("composio"), { ok: true, detail: "The key works." });
  works = false;
  const failed = await keys.test("composio");
  assert.equal(failed.ok, false);
  assert.ok(failed.detail.includes("401") && !failed.detail.includes("ak_composio_5678"));
});

test("a provider's error reads plainly", () => {
  assert.equal(
    plainly('401 {"type":"error","error":{"type":"authentication_error","message":"The API key you provided is invalid."},"request_id":"x"}'),
    "401 · The API key you provided is invalid.",
  );
  assert.equal(plainly('{"error":"Invalid token"}'), "Invalid token");
  assert.equal(plainly("fetch failed"), "fetch failed");
  assert.equal(plainly("500 {not json"), "500 {not json");
});

test("a key pasted as an env file line gives its value", async () => {
  assert.equal(bare("COMPOSIO_API_KEY=ak_abc123"), "ak_abc123");
  assert.equal(bare('  export FIREWORKS_API_KEY="fw_abc" \n'), "fw_abc");
  assert.equal(bare("OPENROUTER_API_KEY = 'sk-or-1'"), "sk-or-1");
  assert.equal(bare(" ak_plain "), "ak_plain");
  assert.equal(bare("sk-with=equals"), "sk-with=equals");
  assert.equal(bare("abcDEF123=="), "abcDEF123==");
  assert.equal(bare("KEY="), "KEY=");

  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choicePath: join(dir, "models.json"), apps: [composio] });
  const first = await keys.login("composio");
  if (first.kind !== "prompt") return assert.fail("expected a prompt");
  await keys.answer(first.login, "COMPOSIO_API_KEY=ak_composio_5678");
  assert.equal(keys.appKey("composio"), "ak_composio_5678");
});

test("each role's model thinks as much as chosen, within what the model takes; another model keeps the nearest level", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-keys-"));
  const keys = piKeys({ keys: fileCredentials(join(dir, "keys.json")), choicePath: join(dir, "models.json") });
  for (const provider of ["fireworks", "openrouter"]) {
    const first = await keys.login(provider);
    if (first.kind !== "prompt") return assert.fail("expected a prompt");
    await keys.answer(first.login, "secret_key_1234");
  }
  const { models } = await keys.list();
  const thinker = models.find((m) => m.thinking.includes("off") && m.thinking.includes("high"));
  const plain = models.find((m) => m.thinking.length === 1 && m.thinking[0] === "off");
  const always = models.find((m) => m.images && !m.thinking.includes("off"));
  assert.ok(thinker && plain && always, "models that think, that do not, and that always do");

  await assert.rejects(keys.think("chat", "high"), /Choose a model first/);
  await keys.choose("chat", thinker.id);
  assert.equal(keys.thinking("chat"), "off");
  await keys.think("chat", "high");
  assert.equal(keys.thinking("chat"), "high");
  assert.deepEqual((await keys.list()).thinking, { chat: "high", browser: "off" });

  await keys.choose("chat", plain.id);
  assert.equal(keys.thinking("chat"), "off", "a model that does not think");
  await assert.rejects(keys.think("chat", "high"), /does not take/);

  // a model that cannot be off thinks at the nearest level it takes, and says so
  await keys.choose("browser", always.id);
  const shown = (await keys.list()).thinking.browser;
  assert.ok(always.thinking.includes(shown), `${shown} is one of ${always.thinking.join(",")}`);
});
