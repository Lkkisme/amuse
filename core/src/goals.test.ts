import assert from "node:assert/strict";
import { test } from "node:test";
import { addGoal, goalLog, listGoals, noteGoal, parseLog, readGoal, updateGoal } from "./goals.ts";
import { type Entry, type Workspace, noWorkspace } from "./host.ts";

/** A workspace in memory. */
function memoryWorkspace(): Workspace {
  const files = new Map<string, Uint8Array>();
  const under = (folder: string) => [...files.keys()].filter((p) => p.startsWith(`${folder}/`));
  return {
    ...noWorkspace,
    exists: async (path) => files.has(path) || under(path).length > 0,
    write: async (path, data) => void files.set(path, data),
    open: async (path) => {
      const data = files.get(path);
      if (!data) throw new Error(`no ${path}`);
      return { path, type: "text/markdown", size: data.length, data };
    },
    list: async (folder) =>
      [...new Set(under(folder).map((p) => p.slice(folder.length + 1).split("/")[0] ?? ""))].map((name): Entry => ({
        path: `${folder}/${name}`,
        kind: files.has(`${folder}/${name}`) ? "file" : "folder",
        size: 0,
        modified: "",
      })),
  };
}

test("a goal is added as a folder of its own, finished and taken up again with a note in its log, and muted", async () => {
  const files = memoryWorkspace();
  const text = async (path: string) => new TextDecoder().decode((await files.open(path)).data);
  const goal = await addGoal(files, { title: "Learn  Japanese", about: "Enough to read a menu by spring." }, "2026-10-21");
  assert.deepEqual(goal, {
    id: "learn-japanese",
    title: "Learn Japanese",
    status: "active",
    muted: false,
    added: "2026-10-21",
    about: "Enough to read a menu by spring.",
    latest: null,
  });
  assert.equal((await addGoal(files, { title: "Learn Japanese!", about: "" }, "2026-10-21")).id, "learn-japanese-2");
  assert.equal((await addGoal(files, { title: "跑一次半马", about: "" }, "2026-10-22")).id, "跑一次半马");

  await updateGoal(files, "learn-japanese-2", { status: "done" }, "2026-10-23");
  const listed = await listGoals(files);
  assert.deepEqual(
    listed.map((g) => [g.id, g.status]),
    [
      ["跑一次半马", "active"],
      ["learn-japanese", "active"],
      ["learn-japanese-2", "done"],
    ],
  );
  assert.deepEqual(listed[2]?.latest, { day: "2026-10-23", label: "Done", text: "Marked done by the user." });

  await updateGoal(files, "learn-japanese", { status: "done" }, "2026-10-24");
  assert.equal(
    await text("memory/goals/learn-japanese/GOAL.md"),
    "---\ntitle: Learn Japanese\nstatus: done\nadded: 2026-10-21\nclosed: 2026-10-24\n---\n\nEnough to read a menu by spring.\n",
  );
  await updateGoal(files, "learn-japanese", { status: "active", muted: true }, "2026-10-25");
  assert.equal(
    await text("memory/goals/learn-japanese/GOAL.md"),
    "---\ntitle: Learn Japanese\nstatus: active\nadded: 2026-10-21\nmuted: true\n---\n\nEnough to read a menu by spring.\n",
  );
  const reopened = await readGoal(files, "learn-japanese");
  assert.equal(reopened?.muted, true);
  assert.equal(reopened?.latest?.label, "Taken up again");
  // muting alone is not news in the log
  await updateGoal(files, "learn-japanese", { muted: false }, "2026-10-26");
  assert.equal((await goalLog(files, "learn-japanese")).length, 2);
  // what a muted goal's schedule would have said
  await noteGoal(files, "learn-japanese", "2026-10-27", "From  Kana practice", "Did 20 minutes.");
  assert.deepEqual((await goalLog(files, "learn-japanese"))[0], { day: "2026-10-27", label: "From Kana practice", text: "Did 20 minutes." });
  await assert.rejects(noteGoal(files, "gone", "2026-10-27", "x", "y"), /not there/);

  await assert.rejects(updateGoal(files, "../USER.md", { status: "done" }, "2026-10-23"), /not there/);
  assert.equal(await readGoal(files, ".."), null);
});

test("goal files read as they were left: a log newest first, and what is missing filled in", async () => {
  assert.deepEqual(parseLog("# Log\n\n## 2026-10-20 · progress\nDid the first lesson.\n\n## 2026-10-21\nRead about kana."), [
    { day: "2026-10-21", label: "", text: "Read about kana." },
    { day: "2026-10-20", label: "progress", text: "Did the first lesson." },
  ]);
  const files = memoryWorkspace();
  const put = (path: string, content: string) => files.write(path, new TextEncoder().encode(content), true);
  await put("memory/goals/run/GOAL.md", "# Run a half marathon\n\nIn under two hours.");
  await put("memory/goals/old/GOAL.md", "---\ntitle: Old\nstatus: dropped\n---\n");
  assert.equal((await readGoal(files, "old"))?.status, "done", "let go of, before there were two statuses");
  await put("memory/goals/run/log.md", "## 2026-10-21\n10 km today.");
  const goal = await readGoal(files, "run");
  assert.equal(goal?.title, "Run a half marathon");
  assert.equal(goal?.status, "active");
  assert.deepEqual(goal?.latest, { day: "2026-10-21", label: "", text: "10 km today." });
  assert.equal((await goalLog(files, "run")).length, 1);
  assert.deepEqual(await listGoals(memoryWorkspace()), []);
});
