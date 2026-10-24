import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ServiceStore } from "@amuse/core";
import { storeCredentials } from "./credentials.ts";
import { guideNotes, guides } from "./guides.ts";
import { memoryChoices, piKeys } from "./keys.ts";
import { voiceServices } from "./voice.ts";

/** A Vault holding nothing: the key sheet is asked for its providers, not for what is set up. */
const emptyVault: ServiceStore = {
  serviceKey: () => undefined,
  serviceTargets: () => [],
  putService: async () => {},
  dropService: async () => {},
  serviceSecrets: () => [],
};

const urlsOf = (id: string): string[] => {
  const guide = guides[id];
  return guide === undefined ? [] : [guide.home, guide.keys, ...(guide.docs === undefined ? [] : [guide.docs])];
};

test("every provider Pi takes an API key for has a guide", async () => {
  const models = await ModelRuntime.create({ authPath: join(mkdtempSync(join(tmpdir(), "amuse-guides-")), "auth.json"), modelsPath: null, refreshOnCreate: false });
  const ids = models
    .getProviders()
    .filter((p) => p.auth.apiKey?.login !== undefined)
    .map((p) => p.id);
  assert.ok(ids.length > 0);
  assert.deepEqual(
    ids.filter((id) => guides[id] === undefined),
    [],
  );
});

test("the voice services and the apps' key have guides", () => {
  for (const service of voiceServices) assert.ok(guides[service.provider], service.provider);
  assert.ok(guides["composio"]);
});

test("every URL in the guides is https", () => {
  for (const id of Object.keys(guides)) {
    for (const url of urlsOf(id)) {
      assert.equal(new URL(url).protocol, "https:", `${id}: ${url}`);
    }
  }
});

test("every note is from the closed set", () => {
  for (const [id, guide] of Object.entries(guides)) {
    if (guide.note !== undefined) assert.ok(guideNotes.includes(guide.note), id);
  }
});

test("the key sheet is given a guide for every provider and the apps' key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-guides-"));
  const keys = piKeys({
    keys: storeCredentials(emptyVault),
    choices: memoryChoices(),
    apps: [{ id: "composio", name: "Composio", message: "Your key", where: "On composio.dev.", link: { url: "https://composio.dev/", label: "composio.dev" } }],
  });
  const { providers } = await keys.list();
  assert.deepEqual(
    providers.filter((p) => p.guide === null).map((p) => p.id),
    [],
  );
  assert.deepEqual(providers.find((p) => p.id === "deepseek")?.guide, { home: "https://platform.deepseek.com/", keys: "https://platform.deepseek.com/api_keys", docs: null, note: "prepaid" });
});
