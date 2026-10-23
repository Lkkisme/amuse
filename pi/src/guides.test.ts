import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { guideNotes, guides } from "./guides.ts";
import { voiceServices } from "./voice.ts";

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
