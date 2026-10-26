/**
 * What an update brings the user: the changelog is read for the entries under Added and Changed, an instance is told
 * once about the ones it has not seen (never on its first start, which records everything and says nothing), and the
 * main chat's agent gets the report through the host's start hook, as the server wires it (main.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type AgentIO, type Timers, type Turn, createHost } from "@amuse/core";
import { migratedDatabase, migratedNow } from "@amuse/db";
import { demoPorts } from "@amuse/demo";
import { type Entry, changelogEntries, news, report, sqliteAnnounced } from "./whats-new.ts";

const idle: Timers<number> = { set: () => 0, clear: () => {} };

const changelog = [
  "# Changelog",
  "",
  "What changed in each release of Amuse, for the people who run it.",
  "",
  "## [Unreleased]",
  "",
  "### Upgrade notes",
  "- **Your data moves into one database on first start.** Nothing to do.",
  "",
  "### Added",
  "- Amuse can now read your mail for you.",
  "- `amuse-admin`, a command on the server: export a chat's history as JSONL.",
  "- A browser task that uses up its steps pauses instead of ending. Amuse then asks you what to do.",
  "",
  "### Changed",
  "- Settings › Sandbox is Settings › Computer.",
  "",
  "### Fixed",
  "- A restart no longer leaves a browser card blank.",
  "",
  "## [0.1.0] - 2026-10-21",
  "",
  "The first release.",
  "",
  "### Added",
  "- Chat with Amuse in a main chat and side chats.",
  "",
  "[Unreleased]: https://github.com/Microwave-WYB/amuse/compare/v0.1.0...HEAD",
].join("\n");

test("the parser reads the bullets under Added and Changed, in Unreleased and in a release, and nothing else", () => {
  assert.deepEqual(
    changelogEntries(changelog).map((e) => [e.section, e.text]),
    [
      ["Added", "Amuse can now read your mail for you."],
      ["Added", "A browser task that uses up its steps pauses instead of ending. Amuse then asks you what to do."],
      ["Changed", "Settings › Sandbox is Settings › Computer."],
      ["Added", "Chat with Amuse in a main chat and side chats."],
    ],
  );
  // an entry is its bullet: the same one under a release heading is the same entry
  const moved = changelogEntries("## [0.2.0] - 2026-11-01\n\n### Added\n- Amuse can now read your mail for you.");
  assert.equal(changelogEntries(changelog)[0]?.id, moved[0]?.id);
});

test("the changelog that ships is read as entries, the user-facing ones only", () => {
  const entries = changelogEntries(readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8"));
  assert.ok(entries.length > 10, "the changelog has entries");
  assert.deepEqual([...new Set(entries.map((e) => e.section))].sort(), ["Added", "Changed"]);
  assert.equal(entries.filter((e) => /amuse-admin/.test(e.text)).length, 0, "operator-only bullets are left out");
});

test("a Windows checkout announces the same entries as a Unix checkout", () => {
  assert.deepEqual(changelogEntries(changelog.replaceAll("\n", "\r\n")), changelogEntries(changelog));
});

test("the report holds the entries, each clipped to its first sentence", () => {
  assert.match(
    report(changelogEntries(changelog)),
    /^\[Amuse was updated\] New: Amuse can now read your mail for you\. A browser task that uses up its steps pauses instead of ending\. Chat with Amuse in a main chat and side chats\. Changed: Settings › Sandbox is Settings › Computer\.$/,
  );
});

test("a report of many entries is clipped to about 1500 characters", () => {
  const many: Entry[] = Array.from({ length: 60 }, (_, i) => ({ id: `e-${i}`, section: "Added", text: `Something new number ${i} happened here today. And here is the detail nobody needs to read.` }));
  const said = report(many);
  assert.ok(said.length <= 1_500, `about 1500 characters, not ${said.length}`);
  assert.ok(said.endsWith("…"), "and it says that it was cut");
  assert.ok(!said.includes("nobody needs to read"));
});

test("the first start on an instance records every entry and says nothing", () => {
  const db = migratedNow();
  const announced = sqliteAnnounced(db);
  const entries = changelogEntries(changelog);
  assert.equal(news(entries, announced), null, "nothing is said on a fresh install");
  assert.equal(announced.seen().size, entries.length, "and everything there is is recorded as seen");
  assert.equal(news(entries, announced), null, "so the next start has nothing new either");
  db.close();
});

test("an update is announced once, with only the new entries", async () => {
  const db = await migratedDatabase();
  const announced = sqliteAnnounced(db);
  assert.equal(news(changelogEntries(changelog), announced), null, "this code's own start: everything recorded, nothing said");

  const after = changelogEntries(`${changelog}\n### Added\n- Amuse can now answer the phone for you.\n`);
  const fresh = news(after, announced);
  assert.equal(fresh?.note, "[Amuse was updated] New: Amuse can now answer the phone for you.");
  assert.equal(news(after, announced)?.note, fresh?.note, "nothing is marked until it is delivered");

  fresh?.delivered();
  assert.equal(news(after, announced), null, "delivered once, and a restart says nothing");
  assert.equal(announced.seen().size, after.length, "every entry of the changelog now is recorded");
  db.close();
});

test("the report wakes the main chat's agent, and a restart with nothing new says nothing", async () => {
  const db = await migratedDatabase();
  const announced = sqliteAnnounced(db);
  // as main.ts wires it: the server's own word to the main chat's agent, at the start
  const start = (entries: Entry[]) => (main: AgentIO) => {
    const fresh = news(entries, announced);
    if (!fresh) return;
    main.report(fresh.note);
    fresh.delivered();
  };
  const turns: Turn[] = [];
  const heard: string[] = [];
  const ports = {
    ...demoPorts(idle),
    prompt: (turn: Turn, agent: AgentIO) => {
      turns.push(turn);
      heard.push(agent.chat);
    },
  };

  createHost(ports, { started: start(changelogEntries(changelog)), timers: idle });
  assert.deepEqual(turns, [], "the first start says nothing");

  const next = changelogEntries(`${changelog}\n### Changed\n- Settings is one page now.\n`);
  createHost(ports, { started: start(next), timers: idle });
  assert.deepEqual(heard, ["main"], "the main chat's agent is the one woken");
  assert.deepEqual(turns, [{ kind: "note", text: "[Amuse was updated] Changed: Settings is one page now." }]);

  createHost(ports, { started: start(next), timers: idle });
  assert.equal(turns.length, 1, "a restart with nothing new says nothing");
  db.close();
});
