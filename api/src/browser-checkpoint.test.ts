import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import type { Browser, Envelope } from "@amuse/protocol";
import { consumeBrowserCheckpoint, readBrowserJournal, snapshotBrowsers } from "./browser-checkpoint.ts";

const at = "2026-10-21T12:00:00.000Z";
const browser = (id: string, status: Browser["status"] = "paused", live = true): Browser => ({ kind: "browser", id, at, title: "Owner page", url: "https://example.invalid/", status, instructions: "", result: null, outcome: null, step: null, live, files: [] });
const lines = (browsers: Browser[]) => browsers.map((entity, index): Envelope => ({ seq: index + 1, event: { kind: "upserted", index, entity } })).map((value) => JSON.stringify(value) + "\n").join("");

test("owner checkpoint folds main and side chats read-only and filters unfinished work", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "amuse-browser-checkpoint-")));
  assert.equal(dirname(directory).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(basename(directory).startsWith("amuse-browser-checkpoint-"));
  try {
    const data = join(directory, "data"), native = join(directory, "native");
    mkdirSync(join(data, "chats"), { recursive: true });
    const journalPath = join(data, "events.jsonl");
    const content = lines([browser("held"), browser("idle", "idle"), browser("working", "working"), browser("ended", "stopped", false)]) + '{"seq":5,"event":';
    writeFileSync(journalPath, content);
    writeFileSync(join(data, "chats.json"), JSON.stringify([{ id: "side-1", title: "Side", at, updated: at }]));
    writeFileSync(join(data, "chats", "side-1.jsonl"), lines([browser("side-held")]));
    const before = readFileSync(journalPath);
    const snapshot = snapshotBrowsers({ journalPath, directory: native, ownerPid: 123, now: new Date(at) });
    assert.deepEqual(snapshot.browsers.map((entry) => [entry.chat, entry.browser.id, entry.seq]), [["main", "held", 4], ["main", "idle", 4], ["side-1", "side-held", 1]]);
    assert.equal(snapshot.ownerPid, 123); assert.equal(snapshot.createdAt, at);
    assert.deepEqual(readFileSync(journalPath), before, "the Stop helper never repairs or truncates an active journal");
    assert.deepEqual(consumeBrowserCheckpoint(native), snapshot);
    assert.equal(consumeBrowserCheckpoint(native), null, "each owner checkpoint is consumed once");
    const audit = readdirSync(native).find((name) => name.startsWith("resume.consumed.")); assert.ok(audit);
    assert.deepEqual(JSON.parse(readFileSync(join(native, audit), "utf8")), snapshot, "the original checkpoint remains for audit");
    snapshotBrowsers({ journalPath, directory: native });
    snapshotBrowsers({ journalPath, directory: native });
    assert.equal(readdirSync(native).filter((name) => name.startsWith("resume.replaced.")).length, 1, "an unconsumed predecessor is archived instead of deleted");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a malformed complete journal line fails without editing history or writing a checkpoint", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "amuse-browser-checkpoint-")));
  assert.equal(dirname(directory).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(basename(directory).startsWith("amuse-browser-checkpoint-"));
  try {
    const journalPath = join(directory, "events.jsonl");
    writeFileSync(journalPath, lines([browser("held")]) + "{}\n");
    const before = readFileSync(journalPath);
    assert.throws(() => snapshotBrowsers({ journalPath, directory: join(directory, "native") }));
    assert.deepEqual(readFileSync(journalPath), before);
    assert.equal(readdirSync(directory).includes("native"), false);
    assert.equal(readBrowserJournal(join(directory, "absent.jsonl")).seq, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
