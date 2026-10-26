/**
 * What an update brought, from CHANGELOG.md: the entries a user would notice (Added and Changed), which this
 * instance has not announced yet. The server sends the main chat's agent one report when it starts with news, and
 * the agent tells the user what they can do now; the entries are marked announced once it has the report, so a
 * restart says nothing twice. The first start on an instance records every entry and says nothing: a fresh install,
 * or the very update that added this, must not dump the whole history at the user.
 */
import { createHash } from "node:crypto";
import { type Db, query, transaction } from "@amuse/db";
import { z } from "zod";

/** One changelog bullet the user would notice, and where it sits. */
export interface Entry {
  /** the hash of the bullet: the same bullet under a release heading is the same entry */
  id: string;
  section: "Added" | "Changed";
  text: string;
}

/** A release heading: `## [Unreleased]` or `## [1.2.3] - 2026-10-21`. Anything else under `##` is not read. */
const release = /^\[?(Unreleased|\d+\.\d+\.\d+)\]?/;
/** What only an operator can do (running the server), not the user in the app. */
const operatorOnly = /amuse-admin/;

/** Every entry the changelog holds: the bullets under Added and Changed, in the order they are written. */
export function changelogEntries(changelog: string): Entry[] {
  const entries: Entry[] = [];
  let under = false;
  let section: Entry["section"] | null = null;
  for (const line of changelog.split(/\r?\n/)) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (heading[1] === "##") {
        under = release.test(heading[2] ?? "");
        section = null;
      } else {
        const title = heading[2];
        section = title === "Added" || title === "Changed" ? title : null;
      }
      continue;
    }
    if (!under || section === null) continue;
    const text = /^-\s+(.+)$/.exec(line)?.[1]?.trim();
    if (!text || operatorOnly.test(text)) continue;
    entries.push({ id: createHash("sha256").update(text).digest("hex"), section, text });
  }
  return entries;
}

/** About how long the report may be: the agent is told what is new, not handed the changelog. */
const LIMIT = 1_500;

/** The bullet's first sentence: what it is, in its own words, without the detail that follows. */
function firstSentence(text: string): string {
  const end = text.search(/\.(\s|$)/);
  return end < 0 ? text : text.slice(0, end + 1);
}

/** The report for these entries, clipped: `[Amuse was updated] New: … Changed: …`. */
export function report(entries: Entry[]): string {
  const said = (section: Entry["section"]) => entries.filter((e) => e.section === section).map((e) => firstSentence(e.text));
  const added = said("Added");
  const changed = said("Changed");
  const lines = [added.length > 0 ? `New: ${added.join(" ")}` : "", changed.length > 0 ? `Changed: ${changed.join(" ")}` : ""].filter(Boolean);
  const text = `[Amuse was updated] ${lines.join(" ")}`;
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT - 1).trimEnd()}…`;
}

/** The entries an instance has announced, in the database. */
export interface Announced {
  seen(): Set<string>;
  mark(ids: string[]): void;
}

export function sqliteAnnounced(db: Db): Announced {
  return {
    seen: () => new Set(query(db, z.object({ hash: z.string() }), "select hash from announced_changes").map((row) => row.hash)),
    mark: (ids) =>
      transaction(db, () => {
        const add = db.prepare("insert into announced_changes (hash) values (?) on conflict (hash) do nothing");
        for (const id of ids) add.run(id);
      }),
  };
}

/** This start's report, and how to mark it announced. */
export interface News {
  note: string;
  /** Once the main chat's agent has it. */
  delivered(): void;
}

/** What to tell the main chat about this start; null when there is nothing new (a first start records everything and says nothing). */
export function news(entries: Entry[], announced: Announced): News | null {
  const seen = announced.seen();
  // an instance that has announced nothing is starting for the first time: it records what is there and says nothing
  if (seen.size === 0) {
    announced.mark(entries.map((e) => e.id));
    return null;
  }
  const fresh = entries.filter((e) => !seen.has(e.id));
  if (fresh.length === 0) return null;
  return { note: report(fresh), delivered: () => announced.mark(fresh.map((e) => e.id)) };
}
