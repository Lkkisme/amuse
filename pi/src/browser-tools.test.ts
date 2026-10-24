import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageView } from "@amuse/browser";
import { fauxProvider } from "@earendil-works/pi-ai";
import { type BrowserLook, readBrowser } from "./browser-read.ts";
import { type PiModelConfig, runtime, seesImages } from "./session.ts";
import { jobGiven } from "./tools.ts";

/** The page a browser task is on. */
const view: PageView = {
  url: "https://sso.example/next",
  title: "SHAPE training",
  text: "Module 2 of 6",
  elements: [],
};

/** Browsers with one run open, `b-1` (and a picture of it, where one is given). */
const browsers = (png: Uint8Array | null = null): BrowserLook => ({
  look: async (id) => {
    if (id !== "b-1") throw new Error(`browser run ${id} is not open`);
    return view;
  },
  screenshot: async () => png,
});

/** A chat whose model takes no pictures (nothing is set up). */
const blind: PiModelConfig = { model: () => null, auth: { kind: "environment" } };

/** What the tool said, apart from any picture. */
const told = (result: { content: ({ type: "text"; text: string } | { type: "image" })[] }): string =>
  result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

test("read_browser gives the page a browser task is on as untrusted data, and refuses a task that is not open", async () => {
  const read = await readBrowser(blind, browsers(), "b-1");
  assert.equal(
    told(read),
    "<untrusted>\nSHAPE training\nhttps://sso.example/next\n\nModule 2 of 6\n</untrusted>",
    "where it is and what is on it, as data: never instructions",
  );
  const missing = await readBrowser(blind, browsers(), "b-9");
  assert.equal(told(missing), "There is no browser open for b-9.");
});

test("an external harness reads the browser without selecting or starting a Pi model", async () => {
  let screenshots = 0;
  const read = await readBrowser(undefined, {
    look: async () => view,
    screenshot: async () => { screenshots++; return new Uint8Array([1, 2, 3]); },
  }, "b-1");
  assert.match(told(read), /Module 2 of 6/);
  assert.equal(read.content.length, 1);
  assert.equal(screenshots, 0, "a harness with no vision configuration gets text without fetching a picture");
});

test("a picture of the page comes with it only where the chat's model sees pictures", async () => {
  const png = new Uint8Array([1, 2, 3]);
  assert.deepEqual((await readBrowser(blind, browsers(png), "b-1")).content.filter((c) => c.type === "image"), [], "a model that sees none is given none");
  const cfg: PiModelConfig = { model: () => "faux/scripted", auth: { kind: "environment" } };
  assert.equal(await seesImages(cfg), false, "not before its provider is known");
  (await runtime(cfg)).registerNativeProvider(fauxProvider({ provider: "faux", models: [{ id: "scripted" }] }).provider);
  assert.equal(await seesImages(cfg), true);
  const read = await readBrowser(cfg, browsers(png), "b-1");
  assert.deepEqual(
    read.content.find((c) => c.type === "image"),
    { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
  );
  assert.match(told(read), /Module 2 of 6/, "and the page's text with it");
});

test("a browser in the middle of another task cannot take a new one, and it is said so plainly", () => {
  assert.equal(jobGiven("b-1", { ok: true, id: "b-1" }), "Given to browser b-1; it goes on there in the background.");
  const busy = jobGiven("b-1", { ok: false, rejection: { kind: "invalid", action: "browserJob", from: "working" } });
  assert.match(busy, /^NOT given: browser b-1 is in the middle of another task and cannot take a new instruction now\./);
  assert.match(busy, /`read_browser` shows what it is doing\./);
  assert.match(busy, /Wait for it to finish, or start another browser with `url`\./);
  assert.match(busy, /Do not tell the user the browser was asked anything\./);
  assert.equal(jobGiven("b-1", { ok: false, rejection: { kind: "gone", id: "b-1" } }), "Not given: the browser of b-1 is gone.");
});
