/**
 * Goals: what the user is working toward. Each is a folder in the workspace
 * (memory/goals/<id>/) that the user and Amuse both keep: GOAL.md says what
 * it is and where it stands, log.md has a dated note a day it moved (from the
 * conversation, or Amuse's research at night). A goal does nothing itself:
 * the work for it is the schedules that serve it (Schedule.goal), and its
 * nightly research. The user adds, mutes, finishes and reopens them on its
 * page in the Amuse panel, or asks Amuse to.
 */
import { z } from "zod";

/** working on it, or done (reached, or no longer wanted); a done one can be taken up again */
export const GoalStatus = z.enum(["active", "done"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** A dated note in a goal's log: its day, what kind of note ("Progress", "Research"; may be empty) and what it says. */
export const GoalNote = z.object({ day: z.string(), label: z.string(), text: z.string() });
export type GoalNote = z.infer<typeof GoalNote>;

export const Goal = z.object({
  /** its folder's name */
  id: z.string(),
  title: z.string(),
  status: GoalStatus,
  /** Amuse works on it as ever but tells the user nothing of it unasked (its schedules' and its nightly reports) */
  muted: z.boolean(),
  /** the day it was added (YYYY-MM-DD, the user's) */
  added: z.string(),
  /** what it is and where it stands (GOAL.md, after the front matter) */
  about: z.string(),
  /** the latest note in its log */
  latest: GoalNote.nullable(),
});
export type Goal = z.infer<typeof Goal>;
