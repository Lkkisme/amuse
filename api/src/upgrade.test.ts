/**
 * Upgrades: every released version's data folder (db/fixtures/<version>/data, see the README there) is started on this
 * code, so the whole migration chain runs from it. Each must come out with what it kept, its other files untouched, and a
 * second start that changes nothing. A new release adds its folder here and its `facts` below.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createHost, type Timers } from "@amuse/core";
import { type Db, dataMigrations, dumpSchema, loadMigrations, applied, query, tempFolder } from "@amuse/db";
import { demoPorts } from "@amuse/demo";
import { Chat } from "@amuse/protocol";
import { z } from "zod";
import { sqliteAccess } from "./access.ts";
import { type Location, locate, openData } from "./data.ts";
import { sqliteChats } from "./journal.ts";
import { sqliteDefaults } from "./defaults.ts";
import { sqliteRules } from "./rules.ts";
import { sqliteSent } from "./sent.ts";

const fixtures = fileURLToPath(new URL("../../db/fixtures/", import.meta.url));
const idle: Timers<number> = { set: () => 0, clear: () => {} };

/** Every file under `dir`, by path, with its content's hash. */
function tree(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else found[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir);
  return found;
}

/** What stays as files: the Secret store's (keys, the model choice, the sandbox's secrets) and the workspace. */
const stays = (name: string) => /^(keys|models|sandbox-secrets)\.json$/.test(name) || name.startsWith("workspace/");
const only = (files: Record<string, string>, keep: (name: string) => boolean) => Object.fromEntries(Object.entries(files).filter(([name]) => keep(name)));
/** What is imported, so renamed to <name>.bak and never deleted. */
const imported = (files: Record<string, string>) => only(files, (name) => !stays(name));

interface Upgraded {
  db: Db;
  where: Location;
  /** the fixture's files as they were */
  before: Record<string, string>;
}

/** What each release's instance must still have after the upgrade: its own, by version. */
const facts: Record<string, (upgraded: Upgraded) => Promise<void>> = {
  "0.1.0": async ({ db, where }) => {
    // the owner still gets in with their password, and the sessions they had are kept
    const access = sqliteAccess(db);
    assert.equal(access.ready(), true);
    assert.equal(await access.login("not the password"), null);
    assert.ok(await access.login("fixture-password-0.1.0"));
    assert.equal(query(db, z.object({ n: z.number() }), "select count(*) as n from sessions")[0]?.n, 3, "two sessions kept, and the one just opened");
    // the rules as the release kept them
    const rules = sqliteRules(db);
    assert.deepEqual(await rules.of("gmail"), { destructive: "deny", write: "ask" });
    assert.deepEqual(await rules.of("github"), { read: "allow" });
    assert.deepEqual(await rules.browser(), { download: "ask" });
    assert.deepEqual(await rules.sites(), { "bank.example": { never: true, actions: {} }, "news.example": { never: false, actions: { submit: "allow" } } });
    assert.deepEqual(sqliteDefaults(db).setUp(), ["memory", "people", "reflection", "wrap-up"]);
    // the photo that was sent is still the user's
    const sent = Object.values(sqliteSent(db).load());
    assert.deepEqual(sent.map((s) => [s.by, s.attachment.name]), [["user", "cat.jpg"]]);
    // the chats, with their conversation
    const chats = sqliteChats(db).load();
    assert.equal(chats.length, 2);
    const host = createHost(demoPorts(idle), { store: sqliteChats(db), timers: idle });
    const main = await host.call("session.sync", { chat: "main", since: null });
    assert.ok(main.kind === "snapshot" && main.state.entities.some((e) => e.kind === "prompt" && e.text === "Hello Amuse, remember that I like tea."));
    const side = chats.find((c) => c.id !== "main");
    const sideState = await host.call("session.sync", { chat: side?.id ?? "", since: null });
    assert.ok(sideState.kind === "snapshot" && sideState.state.entities.some((e) => e.kind === "prompt" && e.text === "A side thought about the garden"));
    // not the database's: the keys, the model choice, the sandbox's secrets, the workspace
    assert.ok(existsSync(join(where.dir, "keys.json")) && existsSync(join(where.dir, "models.json")) && existsSync(join(where.dir, "sandbox-secrets.json")));
    assert.equal(readFileSync(join(where.dir, "workspace", "memory", "MEMORY.md"), "utf8"), "# Memory\n\n- Fixture user likes tea.\n");
  },
};

const versions = readdirSync(fixtures).filter((name) => statSync(join(fixtures, name)).isDirectory());

test("there is a fixture for 0.1.0, and facts for every fixture", () => {
  assert.ok(versions.includes("0.1.0"));
  for (const version of versions) assert.ok(facts[version], `${version} has a fixture but no facts in upgrade.test.ts`);
});

for (const version of versions) {
  test(`an instance of ${version} upgrades through every migration, and a second start changes nothing`, async () => {
    const dir = tempFolder(`amuse-upgrade-${version}-`);
    cpSync(join(fixtures, version, "data"), dir, { recursive: true });
    const before = tree(dir);
    const said: string[] = [];
    const where = locate({ AMUSE_DATA: dir });

    const db = await openData(where, (m) => void said.push(m));
    // the whole chain ran, in order
    const known = (await loadMigrations(dataMigrations)).map((m) => m.version);
    assert.deepEqual(applied(db), known);
    // what is imported is renamed, not deleted, and byte for byte
    const after = tree(dir);
    for (const [name, hash] of Object.entries(imported(before))) {
      assert.equal(after[name], undefined, `${name} should be renamed`);
      assert.equal(after[`${name}.bak`], hash, `${name}.bak should be ${name} as it was`);
    }
    // what is not is untouched
    assert.deepEqual(only(after, stays), only(before, stays));
    // every event in the old journals is in the database
    const lines = (file: string) => readFileSync(join(dir, `${file}.bak`), "utf8").split("\n").filter(Boolean).length;
    const chats = z.array(Chat).parse(JSON.parse(readFileSync(join(dir, "chats.json.bak"), "utf8")));
    for (const chat of chats) {
      const stored = query(db, z.object({ n: z.number() }), "select count(*) as n from events where chat = ?", chat.id)[0]?.n;
      assert.equal(stored, lines(chat.id === "main" ? "events.jsonl" : join("chats", `${chat.id}.jsonl`)), `events of ${chat.id}`);
    }
    // this release's own facts
    await facts[version]?.({ db, where, before });
    // the schema is what db/schema.sql says
    assert.equal(dumpSchema(db), readFileSync(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)), "utf8"));
    db.close();

    // a second start imports nothing and writes nothing new
    const second = await openData(where, (m) => void said.push(m));
    const outside = (files: Record<string, string>) => only(files, (name) => !name.startsWith("amuse.db"));
    assert.deepEqual(outside(tree(dir)), outside(after));
    assert.equal(query(second, z.object({ n: z.number() }), "select count(*) as n from imported_files")[0]?.n, Object.keys(imported(before)).length);
    second.close();
  });
}
