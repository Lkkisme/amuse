import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { migratedNow } from "@amuse/db";
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

test("SQLite checkpoint reads committed live WAL and both chats without migration or legacy replay", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "amuse-browser-checkpoint-")));
  const data = join(directory, "data"), native = join(directory, "native");
  const db = migratedNow(data);
  try {
    db.exec("pragma wal_autocheckpoint = 0");
    const insertChat = db.prepare("insert into chats (id, title, at, updated) values (?, ?, ?, ?) on conflict(id) do update set title=excluded.title, at=excluded.at, updated=excluded.updated");
    const insertEvent = db.prepare("insert into events (chat, seq, event) values (?, ?, ?)");
    for (const [chat, items] of [["main", [browser("wal-held"), browser("working", "working")]], ["side-db", [browser("wal-side", "idle")]]] as const) {
      insertChat.run(chat, chat, at, at);
      for (const raw of lines([...items]).trim().split("\n")) {
        const envelope = JSON.parse(raw) as Envelope;
        insertEvent.run(chat, envelope.seq, JSON.stringify(envelope.event));
      }
    }
    // The old file is deliberately both stale and invalid: a DB must never fall back to it.
    const journalPath = join(data, "events.jsonl"); writeFileSync(journalPath, "invalid stale legacy data\n");
    const files = ["amuse.db", "amuse.db-wal"].map((name) => join(data, name));
    const digest = () => files.map((file) => createHash("sha256").update(readFileSync(file)).digest("hex"));
    const before = digest();
    const checkpoint = snapshotBrowsers({ journalPath, directory: native });
    assert.deepEqual(checkpoint.browsers.map((item) => [item.chat, item.browser.id, item.seq]), [["main", "wal-held", 2], ["side-db", "wal-side", 1]]);
    assert.deepEqual(digest(), before, "checkpoint never writes the database or committed live WAL; SQLite may update shared-memory reader marks");
    assert.equal(readFileSync(journalPath, "utf8"), "invalid stale legacy data\n");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("an unreadable SQLite source fails instead of resurrecting a valid legacy browser", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "amuse-browser-checkpoint-")));
  try {
    const journalPath = join(directory, "events.jsonl");
    writeFileSync(journalPath, lines([browser("stale-legacy")]));
    writeFileSync(join(directory, "amuse.db"), "damaged");
    assert.throws(() => snapshotBrowsers({ journalPath, directory: join(directory, "native") }));
    assert.equal(readdirSync(directory).includes("native"), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
