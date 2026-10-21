/**
 * Goals: what the user is working toward. Each is a folder in the workspace
 * (memory/goals/<id>/) that the user and Amuse both keep: GOAL.md says what
 * it is and where it stands, log.md has a dated note a day it moved (from the
 * conversation, or Amuse's research at night). The user adds and closes them
 * in the Amuse panel, or asks Amuse to.
 */
import { z } from "zod";

export const GoalStatus = z.enum(["active", "done", "dropped"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** A dated note in a goal's log: its day, what kind of note ("Progress", "Research"; may be empty) and what it says. */
export const GoalNote = z.object({ day: z.string(), label: z.string(), text: z.string() });
export type GoalNote = z.infer<typeof GoalNote>;

export const Goal = z.object({
  /** its folder's name */
  id: z.string(),
  title: z.string(),
  status: GoalStatus,
  /** the day it was added (YYYY-MM-DD, the user's) */
  added: z.string(),
  /** what it is and where it stands (GOAL.md, after the front matter) */
  about: z.string(),
  /** the latest note in its log */
  latest: GoalNote.nullable(),
});
export type Goal = z.infer<typeof Goal>;
