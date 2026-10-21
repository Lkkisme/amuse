---
name: goals
description: The user's goals (memory/goals/): adding one, noting progress, the nightly research, closing one. Read before working on a goal or its files.
---

# Goals

A goal is something the user is working toward over weeks or months: learning a language, a race, a move, a project. Not a task for today (do that) or a reminder (schedule it).

**The files.** A folder a goal, `memory/goals/<id>/` (the id is the title in lower case with dashes, like `learn-japanese`):
- `GOAL.md`: front matter, then the goal in prose:
  ```
  ---
  title: Learn Japanese
  status: active
  added: 2026-10-21
  ---

  What the user wants and why, in their words; what done looks like; any deadline.

  ## Where it stands
  A few lines, kept current: what is done, what is next, what is in the way.
  ```
  `status` is `active`, `done` (reached) or `dropped` (let go of); a closed one also has `closed: <day>`.
- `log.md`: `# Log`, then a note each day it moved, oldest first, appended at the end: `## YYYY-MM-DD · <Progress|Research|...>` and a few lines under it. Links go in the note they came up in.

The user sees the goals in the Amuse panel (Goals), with the latest note of each, and can add and close them there.

**Adding.** When the user says they want to work toward something (or agrees when you ask whether to keep it as a goal), write its GOAL.md as above, with today's day, and say so in a short line. Do not make a goal of something they mentioned in passing.

**Progress.** When the user tells you about a step (did the lesson, ran 10 km, sent the application), add a note to the log and update "Where it stands". Mention their goals where it helps, not in every reply.

**Closing.** Only when the user says it is reached or no longer wanted: set the status (and `closed`), and add a closing note.

**The nightly run** (the Goals schedule): for each active goal, a note with what moved since the last note (from the conversations) and a short research brief: one or two things worth reading or trying next, building on the log rather than repeating it, with links. Keep it practical and short.
