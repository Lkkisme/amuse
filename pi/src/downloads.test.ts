import assert from "node:assert/strict";
import { test } from "node:test";
import { type Workspace, WorkspaceError, noWorkspace } from "@amuse/core";
import { Browser } from "@amuse/protocol";
import { freePath } from "./browser-agent.ts";

/** A workspace where these paths are files, and these are links the workspace will not look at. */
function holding(files: string[], links: string[]): Workspace {
  return {
    ...noWorkspace,
    exists: async (path) => {
      if (links.includes(path)) throw new WorkspaceError(`"${path}" is not in the workspace`);
      return files.includes(path);
    },
  };
}

test("a download keeps its name, or the next free one; a planted link counts as taken", async () => {
  assert.equal(await freePath(holding([], []), "downloads", "bill.pdf"), "downloads/bill.pdf");
  assert.equal(await freePath(holding(["downloads/bill.pdf"], []), "downloads", "bill.pdf"), "downloads/bill (2).pdf");
  assert.equal(await freePath(holding(["downloads/bill.pdf", "downloads/bill (2).pdf"], []), "downloads", "bill.pdf"), "downloads/bill (3).pdf");
  assert.equal(await freePath(holding([], ["downloads/bill.pdf"]), "downloads", "bill.pdf"), "downloads/bill (2).pdf", "a link is no reason to lose the batch");
  assert.equal(await freePath(holding(["downloads/notes"], ["downloads/notes (2)"]), "downloads", "notes"), "downloads/notes (3)");
});

test("when nothing can be looked at, it stops looking rather than go on for ever", async () => {
  const broken: Workspace = {
    ...noWorkspace,
    exists: async () => {
      throw new WorkspaceError("not in the workspace");
    },
  };
  assert.match(await freePath(broken, "downloads", "a.txt"), /^downloads\/a \(999\)\.txt$/);
});

test("handing back a browser whose task was over tells the chat to go on in it; the user's own browser, never given a task, tells nothing", async () => {
  const { handedBack } = await import("./browser-agent.ts");
  const browser = Browser.parse({
    kind: "browser",
    id: "b-1",
    at: "2026-10-21T00:00:00Z",
    title: "Log in to Care26",
    url: "https://students.care26.com",
    status: "idle",
    instructions: "Go to the UCSD login and fill in the user name",
    result: "At the UCSD login, user name filled in",
    step: null,
    live: true,
    outcome: "completed",
  });
  assert.match(handedBack(browser) ?? "", /handed it back.*browse with browser b-1.*no_reply/s);
  assert.equal(handedBack({ ...browser, outcome: null }), null);
});
