import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browsers } from "@amuse/browser";
import { StaleRef } from "@amuse/browser";
import { type Workspace, noWorkspace } from "@amuse/core";
import { Browser } from "@amuse/protocol";
import { keepPictureOf } from "./browser-agent.ts";
import { type BrowserLook, saveBrowserShot } from "./browser-read.ts";
import { pictureName, slug } from "./kept-files.ts";

/** The page the fake browser is on. */
const view = { url: "https://sso.example/next", title: "SHAPE training", text: "Module 2 of 6", elements: [] };
const png = new Uint8Array([1, 2, 3]);
const at = new Date("2026-10-21T08:00:00Z");

/** A workspace that keeps what is written to it. */
function keeping(): { files: Workspace; kept: Record<string, Uint8Array> } {
  const kept: Record<string, Uint8Array> = {};
  return {
    kept,
    files: {
      ...noWorkspace,
      exists: async (path) => path in kept,
      write: async (path, data) => void (kept[path] = data),
    },
  };
}

/** Browsers with one run open, `b-1`. */
const looking = (image: Uint8Array | null): BrowserLook => ({
  look: async (id) => {
    if (id !== "b-1") throw new Error(`browser run ${id} is not open`);
    return view;
  },
  screenshot: async () => image,
});

/** The browser task these tests are about. */
const task = Browser.parse({
  kind: "browser",
  id: "b-1",
  at: "2026-10-21T00:00:00Z",
  title: "SHAPE training",
  url: "https://sso.example/next",
  status: "working",
  instructions: "Sign in and open the next module",
  result: null,
  step: null,
  live: true,
  outcome: null,
});

/** The run as keepPictureOf sees it: a browser, and a screenshot that is there, gone, or refused. */
function run(files: Workspace | undefined, image: Uint8Array | null, refuses?: Error) {
  const browsers: Pick<Browsers, "screenshot"> = {
    screenshot: async () => {
      if (refuses) throw refuses;
      return image;
    },
  };
  return { browsers, browser: task, workspace: files, lost: null };
}

/** What a tool result said, apart from any picture. */
const told = (result: { content: ({ type: "text"; text: string } | { type: "image" })[] }): string =>
  result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

test("a picture of the page is saved under screenshots/ with its path, never over one that is there; a task that is not open is refused", async () => {
  const { files, kept } = keeping();
  const first = await saveBrowserShot(files, looking(png), "b-1", at);
  assert.equal(
    told(first),
    "Saved a picture of https://sso.example/next as screenshots/shape-training-20261021-080000.png. Send it to the user with `send_file`.",
  );
  assert.deepEqual(kept["screenshots/shape-training-20261021-080000.png"], png, "the page's own screenshot, byte for byte");
  const again = await saveBrowserShot(files, looking(png), "b-1", at);
  assert.match(told(again), /screenshots\/shape-training-20261021-080000 \(2\)\.png/, "a second one the same minute keeps its own name");
  assert.equal(told(await saveBrowserShot(files, looking(png), "b-9", at)), "There is no browser open for b-9.");
  assert.equal(told(await saveBrowserShot(files, looking(null), "b-1", at)), "Could not save a picture of https://sso.example/next.");
});

test("the browser agent is told where its picture is, so it can pass it on; a ref it cannot picture is refused", async () => {
  const { files, kept } = keeping();
  const said = await keepPictureOf(run(files, png), null, "the confirmation page", "screenshots", at);
  assert.equal(
    told(said),
    "Saved a picture of the confirmation page as screenshots/the-confirmation-page-20261021-080000.png. Mention it in your result, or with tell_main, so Amuse can send it to the user.",
  );
  assert.deepEqual(kept["screenshots/the-confirmation-page-20261021-080000.png"], png);
  // an element, by a ref of the run's own page
  const element = await keepPictureOf(run(files, png), "e3", undefined, "screenshots", at);
  assert.match(told(element), /^Saved a picture of that element as screenshots\/shape-training-20261021-080000\.png/);
  // a ref the look never gave: nothing is written, and the agent is told to look again
  const stale = await keepPictureOf(run(files, null, new StaleRef("e9")), "e9", undefined, "screenshots", at);
  assert.match(told(stale), /^That ref is not on the page any more\. Look at the page again/);
  // nothing of it on the visible page (the browser gave no picture): scroll to it and look again
  const off = await keepPictureOf(run(files, null), "e3", undefined, "screenshots", at);
  assert.match(told(off), /^Nothing of that element is on the visible page\. Scroll to it, look at the page again/);
  assert.deepEqual(Object.keys(kept).sort(), [
    "screenshots/shape-training-20261021-080000.png",
    "screenshots/the-confirmation-page-20261021-080000.png",
  ]);
});

test("an image a page shows is kept under images/, with what the page shows said plainly", async () => {
  const { files, kept } = keeping();
  const said = await keepPictureOf(run(files, png), "e7", "floor plan 3", "images", at);
  assert.match(told(said), /^Kept a picture of floor plan 3 as images\/floor-plan-3-20261021-080000\.png: this browser cannot fetch the file itself/);
  assert.match(told(said), /Mention it in your result, or with tell_main/);
  assert.deepEqual(kept["images/floor-plan-3-20261021-080000.png"], png);
  // nowhere to keep it (no workspace): said so, and nothing is invented
  assert.match(told(await keepPictureOf(run(undefined, png), "e7", undefined, "images", at)), /^Could not keep the picture: no files are kept here\.$/);
});

test("a picture is named after what it is of and when it was taken", () => {
  assert.equal(pictureName("SHAPE training", at), "shape-training-20261021-080000.png");
  assert.equal(pictureName("", at), "page-20261021-080000.png", "a page with no title still has a name");
  assert.equal(pictureName("a/b:c*?\"<>|d", at), "a-b-c-d-20261021-080000.png", "nothing a file name cannot hold");
  assert.equal(pictureName("确认页", at), "确认页-20261021-080000.png", "the user's own words stay theirs");
  assert.equal(pictureName("x".repeat(80), at), `${"x".repeat(60)}-20261021-080000.png`);
  assert.equal(slug("  .- trimmed -."), "trimmed");
});
