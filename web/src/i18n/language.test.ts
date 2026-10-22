import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChoice, resolveLanguage } from "./language.ts";

test("a stored choice is a language or the system's; nothing else, or none, is the system's", () => {
  assert.equal(parseChoice("zh-CN"), "zh-CN");
  assert.equal(parseChoice("en"), "en");
  assert.equal(parseChoice("system"), "system");
  assert.equal(parseChoice("fr"), "system");
  assert.equal(parseChoice(null), "system");
});

test("a chosen language is used whatever the browser prefers", () => {
  assert.equal(resolveLanguage("en", ["zh-CN"]), "en");
  assert.equal(resolveLanguage("zh-CN", ["en-US"]), "zh-CN");
});

test("following the system: Chinese for any Chinese variant the browser prefers, else English", () => {
  for (const tag of ["zh", "zh-CN", "zh-Hans", "zh-SG", "zh-TW", "zh-HK"]) {
    assert.equal(resolveLanguage("system", [tag]), "zh-CN", tag);
  }
  assert.equal(resolveLanguage("system", ["en-GB"]), "en");
  assert.equal(resolveLanguage("system", ["fr-FR", "de"]), "en");
  assert.equal(resolveLanguage("system", []), "en");
});

test("following the system takes the first preference that is Chinese or English", () => {
  assert.equal(resolveLanguage("system", ["fr-FR", "zh-CN", "en-US"]), "zh-CN");
  assert.equal(resolveLanguage("system", ["fr-FR", "en-US", "zh-CN"]), "en");
});

test("the active language is the stored choice's, and changes at once", async () => {
  const kept = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    },
  });
  kept.set("amuse.language", "zh-CN");
  const language = await import("./language.ts");
  assert.equal(language.currentChoice(), "zh-CN");
  assert.equal(language.activeLanguage(), "zh-CN");
  assert.equal(language.activeLocale(), "zh-CN");
  assert.equal(language.activeT().time.today("8:00"), "今天 8:00");

  let heard = 0;
  const unsubscribe = language.subscribeLanguage(() => heard++);
  language.setChoice("en");
  assert.equal(kept.get("amuse.language"), "en");
  assert.equal(language.currentChoice(), "en");
  assert.equal(language.activeLanguage(), "en");
  assert.equal(language.activeLocale(), "en-US");
  assert.equal(language.activeT().time.today("8:00"), "Today, 8:00");
  assert.equal(heard, 1);
  unsubscribe();
  language.setChoice("zh-CN");
  assert.equal(heard, 1);
});
