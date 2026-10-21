import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Missing, enter, kindOf, openFile, remove, top, walk } from "./descend.ts";

/** A top folder with a/b/ in it, and an outside folder holding a secret. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "amuse-descend-"));
  const root = join(dir, "root");
  const outside = join(dir, "outside");
  mkdirSync(join(root, "a/b"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "secret"), "keys");
  return { dir, root, outside };
}

test("a link on the way is refused, whether it leads to a folder or nowhere", async () => {
  const { root, outside } = setup();
  symlinkSync(outside, join(root, "out"));
  symlinkSync(join(root, "nowhere"), join(root, "dangling"));
  await assert.rejects(walk(root, ["out"]), /"out" is not in the workspace/);
  symlinkSync(outside, join(root, "a/out"));
  await assert.rejects(walk(root, ["a", "out"]), /"a\/out" is not in the workspace/);
  await assert.rejects(walk(root, ["dangling"]), /"dangling" is not in the workspace/);
  writeFileSync(join(root, "file"), "x");
  await assert.rejects(walk(root, ["file"]), /file is not a folder/);
  await assert.rejects(walk(root, ["nothing"]), Missing);
  const made = await walk(root, ["new", "deeper"], true);
  await made.close();
  assert.ok(existsSync(join(root, "new/deeper")));
});

test("a folder swapped for a link after it was opened cannot redirect what is done through it", async () => {
  const { root, outside } = setup();
  const top1 = await top(root);
  const a = await enter(top1, "a", "a");
  // now the sandbox swaps a for a link to the outside
  renameSync(join(root, "a"), join(root, "a-moved"));
  symlinkSync(outside, join(root, "a"));
  // a name looked up again would lead outside; through the folder held, it is still the one that was opened
  assert.equal(await kindOf(a, "b"), "folder");
  assert.equal(await kindOf(a, "secret"), "missing");
  const handle = await open(a.at("written"), "wx");
  await handle.writeFile("here");
  await handle.close();
  assert.equal(readFileSync(join(root, "a-moved/written"), "utf8"), "here");
  assert.deepEqual(readdirSync(outside), ["secret"], "nothing went outside");
  // and one level down from the held folder is still inside it
  const b = await enter(a, "b", "a/b");
  await writeFile(b.at("deep"), "d");
  assert.ok(existsSync(join(root, "a-moved/b/deep")));
  // while walking the path again meets the link
  await assert.rejects(walk(root, ["a", "b"]), /not in the workspace/);
  for (const folder of [b, a, top1]) await folder.close();
});

test("a file swapped for a link is refused, and a pipe put in its place does not hang", async () => {
  const { root, outside } = setup();
  const folder = await walk(root, ["a"]);
  symlinkSync(join(outside, "secret"), join(root, "a/leaf"));
  await assert.rejects(openFile(folder, "leaf", "a/leaf"), /"a\/leaf" is not in the workspace/);
  assert.equal(await kindOf(folder, "leaf"), "link");
  execFileSync("mkfifo", [join(root, "a/pipe")]);
  await assert.rejects(openFile(folder, "pipe", "a/pipe"), /there is no file a\/pipe/);
  await assert.rejects(openFile(folder, "b", "a/b"), /there is no file a\/b/, "a folder is no file");
  await assert.rejects(openFile(folder, "gone", "a/gone"), Missing);
  await folder.close();
});

test("a recursive delete never follows a link: the link goes, what it led to stays", async () => {
  const { root, outside } = setup();
  mkdirSync(join(root, "tree/inner"), { recursive: true });
  writeFileSync(join(root, "tree/inner/f"), "x");
  symlinkSync(outside, join(root, "tree/inner/out"));
  symlinkSync(join(outside, "secret"), join(root, "tree/file-link"));
  const folder = await top(root);
  await remove(folder, "tree");
  assert.ok(!existsSync(join(root, "tree")));
  assert.equal(readFileSync(join(outside, "secret"), "utf8"), "keys");
  // a link at the top of what is deleted is deleted itself
  symlinkSync(outside, join(root, "top-link"));
  await remove(folder, "top-link");
  assert.ok(!existsSync(join(root, "top-link")));
  assert.ok(existsSync(outside));
  await remove(folder, "never-there");
  await folder.close();
});
