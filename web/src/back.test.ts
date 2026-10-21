import assert from "node:assert/strict";
import { test } from "node:test";
import { close, layers } from "./back.ts";
import type { KeyProvider } from "@amuse/protocol";
import { type Ui, initialUi } from "./ui.ts";

const app = { id: "gmail", name: "Gmail", description: "Email", logo: null };
const deep: Ui = {
  ...initialUi,
  museOpen: true,
  settings: { open: true, section: "connectors", app, provider: null },
  explainer: "c1",
};

test("layers are listed bottom to top; a settings section is a layer only on a phone", () => {
  assert.deepEqual(layers(initialUi, true), []);
  assert.deepEqual(layers(deep, true), [
    "muse",
    "settings",
    "section",
    "app",
    "explainer",
  ]);
  assert.deepEqual(layers(deep, false), [
    "muse",
    "settings",
    "app",
    "explainer",
  ]);
});

test("a key provider's page is a layer over its section, and Back leaves it first", () => {
  const provider: KeyProvider = {
    id: "fireworks",
    name: "Fireworks",
    use: "models",
    connected: true,
    hint: "…1234",
  };
  const page: Ui = {
    ...initialUi,
    settings: { open: true, section: "models", app: null, provider },
  };
  assert.deepEqual(layers(page, true), ["settings", "section", "provider"]);
  assert.deepEqual(close(page, "provider").settings, {
    ...page.settings,
    provider: null,
  });
});

test("closing the top layer each time unwinds them one at a time, down to nothing", () => {
  let ui = deep;
  const seen: string[] = [];
  for (let top = layers(ui, true).at(-1); top; top = layers(ui, true).at(-1)) {
    const before = layers(ui, true).length;
    ui = close(ui, top);
    assert.equal(
      layers(ui, true).length,
      before - 1,
      `closing ${top} closes only it`,
    );
    seen.push(top);
  }
  assert.deepEqual(seen, ["explainer", "app", "section", "settings", "muse"]);
});
