import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hint, Problem } from "@amuse/db";
import { type Language, catalogs, explain, languageOf, problemPage, serveProblem } from "./startup.ts";

const languages: Language[] = ["en", "zh-CN"];
const hints: Hint[] = ["compose-up", "data-volume"];
const troubles: Extract<Problem, { kind: "folder" }>["trouble"][] = ["missing", "not-a-folder", "not-writable"];

/** One of each kind of problem, with sample values: a kind added to Problem does not compile here until it is listed. */
const samples: { [K in Problem["kind"]]: Extract<Problem, { kind: K }> } = {
  configuration: { kind: "configuration", trouble: "folders-differ" },
  folder: { kind: "folder", folder: "workspace", path: "/data/workspace", trouble: "not-writable", hint: "compose-up" },
  "database-newer": { kind: "database-newer", needed: "20270101000000", known: "20261023100100" },
  "database-unreadable": { kind: "database-unreadable", path: "/data/amuse.db", message: "DETAIL file is not a database" },
  "backup-failed": { kind: "backup-failed", message: "DETAIL no space left on device" },
  "migration-failed": { kind: "migration-failed", version: "20261023100100", name: "import_json", message: "DETAIL SyntaxError: Unexpected token 's3cret' in JSON at position 4", backup: "/data/backups/x-pre-migrate.db" },
  "journal-unreadable": { kind: "journal-unreadable", chat: "c-1", event: 7 },
  "old-files": { kind: "old-files", files: ["events.jsonl", "access.json"] },
};

test("every kind of problem has its words in each language, using what happened", () => {
  for (const problem of Object.values(samples)) {
    for (const language of languages) {
      const { what, todo } = explain(problem, language);
      assert.ok(what.length > 5 && todo.length > 10, `${problem.kind} in ${language}`);
    }
  }
  const failed = samples["migration-failed"];
  for (const language of languages) {
    const { what, todo } = explain(failed, language);
    assert.ok(what.includes("20261023100100") && what.includes("import_json"), `the step is named, in ${language}`);
    assert.ok(!todo.includes("/data/backups"), "the backup is the backups folder, not a path");
  }
  assert.ok(explain(samples["database-newer"], "en").what.includes("20270101000000"));
  // each hint, each trouble
  for (const hint of hints)
    for (const trouble of troubles)
      assert.notEqual(explain({ kind: "folder", folder: "data", path: "/p", trouble, hint }, "en").todo, explain({ kind: "folder", folder: "data", path: "/p", trouble, hint: hint === "compose-up" ? "data-volume" : "compose-up" }, "en").todo);
  assert.match(explain(samples.folder, "en").todo, /docker compose up -d/);
  assert.match(explain(samples.folder, "zh-CN").what, /无法写入/);
  assert.notEqual(catalogs.en.title, catalogs["zh-CN"].title);
});

test("the page is seen before anyone signs in: no path of this machine, and nothing of what SQLite, zod or JSON.parse said, in any language", () => {
  for (const problem of Object.values(samples)) {
    for (const language of languages) {
      const page = problemPage(problem, language);
      assert.doesNotMatch(page, /DETAIL|s3cret|\/data|amuse\.db|SyntaxError/, `${problem.kind} in ${language}`);
    }
  }
  assert.match(explain(samples["old-files"], "en").todo, /amuse-admin retire-old-files/);
  assert.match(explain(samples["old-files"], "en").todo, /Never run an older version on this data/);
  assert.match(explain(samples["old-files"], "zh-CN").todo, /千万不要在这份数据上运行旧版本/);
  assert.match(explain({ kind: "folder", folder: "backups", path: "/data/backups", trouble: "missing", hint: "data-volume" }, "en").what, /^The backups folder is not there/);
});

test("the visitor's language: the first of Chinese or English they ask for", () => {
  assert.equal(languageOf("zh-CN,zh;q=0.9,en;q=0.8"), "zh-CN");
  assert.equal(languageOf("fr-FR, en;q=0.8"), "en");
  assert.equal(languageOf("fr-FR, de"), "en");
  assert.equal(languageOf(undefined), "en");
});

test("the page has no script, and what came from outside is escaped", () => {
  const page = problemPage({ kind: "migration-failed", version: "1", name: '<script>alert("x")</script>', message: "", backup: null }, "en");
  assert.ok(!page.includes("<script"));
  assert.ok(page.includes("&lt;script&gt;"));
  assert.ok(problemPage(samples.folder, "zh-CN").includes('lang="zh-CN"'));
});

test("the server that cannot start answers every request with the page, in the visitor's language", async () => {
  // a free port: bind to 0, learn it, and let it go
  const { createServer } = await import("node:http");
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  const served = await serveProblem(samples["database-newer"], { port, host: "127.0.0.1" });
  const english = await fetch(`http://127.0.0.1:${port}/anything`);
  assert.equal(english.status, 503);
  assert.equal(english.headers.get("cache-control"), "no-store");
  assert.match(await english.text(), /Amuse could not start/);
  const chinese = await fetch(`http://127.0.0.1:${port}/`, { headers: { "accept-language": "zh-CN" } });
  assert.match(await chinese.text(), /Amuse 无法启动/);
  await served.close();
});
