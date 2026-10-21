import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entry, type Workspace, noWorkspace } from "@amuse/core";
import { allSkills, builtInSkills, catalog, parseSkill } from "./skills.ts";

/** A workspace holding just these files. */
function holding(files: Record<string, string>): Workspace {
  const paths = Object.keys(files);
  return {
    ...noWorkspace,
    exists: async (path) => path in files || paths.some((p) => p.startsWith(`${path}/`)),
    open: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`no ${path}`);
      const data = new TextEncoder().encode(content);
      return { path, type: "text/markdown", size: data.length, data };
    },
    list: async (folder) => {
      const names = new Set(paths.filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1).split("/")[0] ?? ""));
      return [...names].map((name): Entry => ({ path: `${folder}/${name}`, kind: `${folder}/${name}` in files ? "file" : "folder", size: 0, modified: "" }));
    },
  };
}

test("a SKILL.md is its front matter's name and description, and the rest", () => {
  const skill = parseSkill('---\nname: trips\ndescription: "Planning a trip"\n---\n\n# Trips\nBook early.', "skills/trips", "fallback");
  assert.deepEqual(skill, { name: "trips", description: "Planning a trip", body: "# Trips\nBook early.", from: "skills/trips" });
  assert.equal(parseSkill("# No front matter", "x", "x"), null, "a skill says what it covers");
  assert.equal(parseSkill("---\ndescription: Only this\n---\nBody", "skills/named-by-folder", "named-by-folder")?.name, "named-by-folder");
});

test("the built-in skills ship with Amuse, each saying what it covers", () => {
  const names = builtInSkills().map((s) => s.name);
  assert.deepEqual([...names].sort(), ["apps", "browser", "delegation", "files", "goals", "memory", "sandbox", "schedules"]);
  for (const skill of builtInSkills()) assert.ok(skill.description.length > 20 && skill.body.length > 200, skill.name);
});

test("the user's skills join the built-in ones, and one of theirs replaces a built-in one of the same name", async () => {
  const files = holding({
    "skills/trips/SKILL.md": "---\nname: trips\ndescription: Planning a trip the way I like\n---\nWindow seats.",
    "skills/browser/SKILL.md": "---\nname: browser\ndescription: My own way with browsers\n---\nAlways ask first.",
    "skills/notes.md": "not a skill folder",
  });
  const skills = await allSkills(builtInSkills(), files);
  const byName = new Map(skills.map((s) => [s.name, s]));
  assert.equal(byName.get("trips")?.from, "skills/trips");
  assert.equal(byName.get("browser")?.description, "My own way with browsers");
  assert.equal(byName.get("memory")?.from, "built in");
  const list = catalog(skills);
  assert.match(list, /^- trips: Planning a trip the way I like$/m);
  assert.match(list, /use_skill/);
});
