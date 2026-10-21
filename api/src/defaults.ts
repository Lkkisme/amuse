/**
 * The schedules every instance starts with, as Muse keeps its memory and its
 * skills: each set up once, when the user writes (on their clock; one added in
 * a later version, the next time they write), and from then on the user's to
 * change or cancel like any other. They run on the background model and work
 * in silence on memory/ (pi/src/memory.ts) and skills/; only the wrap-up and
 * the skill review may tell the user something, and only when it concerns them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DefaultSchedule, Defaults } from "@amuse/pi";
import { z } from "zod";

/** How memory is kept: the memory skill (pi/skills/memory) says it all. */
const memoryRules = "Read the memory skill first (use_skill memory) and keep its conventions: ids, the journal entry with the source, newer replacing older.";

export const defaultSchedules: DefaultSchedule[] = [
  {
    key: "memory",
    title: "Memory",
    cron: "0 * * * *",
    needs: "conversation",
    instructions: [
      "Keep the user's memory current with what was said since this schedule's last run: read the chats (list_chats, read_chat; the main chat is also in your briefing), and look at what memory already holds (memory_search, memory_get).",
      memoryRules,
      "Change only memory/MEMORY.md, memory/USER.md and the journal. This work is silent: do not report to the user.",
    ].join("\n"),
  },
  {
    key: "people",
    title: "People and groups",
    cron: "30 * * * *",
    needs: "conversation",
    instructions: [
      "Keep a page on each person and group in the user's life, from what was said since this schedule's last run (list_chats, read_chat).",
      "memory/people/<Name>.md and memory/groups/<Name>.md: who they are, how they relate to the user, what is going on with them, with dates. Update a page rather than starting another for the same one.",
      "memory/people/INDEX.md and memory/groups/INDEX.md: one line each, closest or most present first.",
      "What is about the user themself belongs in MEMORY.md, not here. Change only memory/people/ and memory/groups/. This work is silent: do not report to the user.",
    ].join("\n"),
  },
  {
    key: "reflection",
    title: "Reflection",
    cron: "0 3 * * *",
    needs: "conversation",
    instructions: [
      "Look back over the last day of conversation, in every chat (list_chats, read_chat).",
      "Write memory/dreams/<today, YYYY-MM-DD>.md, a short reflection: what went well, where there was friction (misunderstandings, corrections, things the user had to say twice), and how the user seems to be doing lately.",
      "Then rewrite memory/dreams/ALIGNMENT.md, which you read before every reply: how to work with this user now (their current focus, how they like you to talk and act, what to avoid: sore spots and past mistakes). Short and practical; the current truth replaces the old.",
      "Change only memory/dreams/. This work is silent: do not report to the user.",
    ].join("\n"),
  },
  {
    key: "wrap-up",
    title: "Wrap-up",
    cron: "*/30 * * * *",
    needs: "lull",
    instructions: [
      "A conversation has just gone quiet; tidy up after it (read it with list_chats and read_chat).",
      `1) What is worth remembering from it that memory does not hold yet (memory_search): add it. ${memoryRules}`,
      "2) Anything left unfinished: an approval or a question still open, a task that failed, something you said you would do and have not.",
      "Report once, briefly, only if something there needs the user; otherwise stay silent.",
    ].join("\n"),
  },
  {
    key: "skill-review",
    title: "Skill review",
    cron: "0 4 * * *",
    needs: "conversation",
    instructions: [
      "Keep the user's skills (skills/ in the workspace) useful, from what happened since this schedule's last run (list_chats, read_chat; look further back when something there seems to have come up before).",
      "1) A job the user has had you do more than once, or shown you how they want done (the steps, the sites and accounts, what to check), that no skill covers yet: write it down as a skill, skills/<name>/SKILL.md, the way the files skill says. Only what actually happened and what the user said; do not make up steps.",
      "2) A skill of theirs that no longer holds: a step that failed while you followed it, a site that changed, an app action it names that is gone (app_tools). Fix it in place.",
      "Do not touch the built-in skills, and do not delete a skill: that is the user's call.",
      "A skill changes how you work from then on, so when you wrote or changed one, report once: each skill, in one line, what it is for, and that it can be changed or deleted in skills/ in Files. Otherwise stay silent.",
    ].join("\n"),
  },
];

/** What was set up before keys: all four of the first defaults. */
const first = ["memory", "people", "reflection", "wrap-up"];

const Marker = z.object({ done: z.boolean().optional(), set: z.array(z.string()).optional() });

/** Which defaults were set up, kept in `path` (a run of the server, a new device: still once each). */
export function fileDefaults(path: string): Defaults {
  return {
    schedules: defaultSchedules,
    setUp: () => {
      if (!existsSync(path)) return [];
      const marker = Marker.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!marker.success) return [];
      return marker.data.set ?? (marker.data.done ? first : []);
    },
    markSetUp: (keys) => writeFileSync(path, JSON.stringify({ set: keys }, null, 2), { mode: 0o600 }),
  };
}
