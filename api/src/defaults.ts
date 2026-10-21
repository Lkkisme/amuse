/**
 * The schedules every instance starts with, as Muse keeps its memory: set up
 * once, when the user first writes (on their clock), and from then on the
 * user's to change or cancel like any other. All of them work in silence on
 * the files in memory/ (pi/src/memory.ts), on the background model; only the
 * quiet sweep may tell the user something, and only when it needs them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DefaultSchedule, Defaults } from "@amuse/pi";

/** How memory is kept: the memory skill (pi/skills/memory) says it all. */
const memoryRules = "Read the memory skill first (use_skill memory) and keep its conventions: ids, the journal entry with the source, newer replacing older.";

export const defaultSchedules: DefaultSchedule[] = [
  {
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
];

/** Whether the defaults were set up, kept in `path` (a run of the server, a new device: still once). */
export function fileDefaults(path: string): Defaults {
  return {
    schedules: defaultSchedules,
    done: () => existsSync(path) && readFileSync(path, "utf8").includes('"done": true'),
    markDone: () => writeFileSync(path, JSON.stringify({ done: true }, null, 2), { mode: 0o600 }),
  };
}
