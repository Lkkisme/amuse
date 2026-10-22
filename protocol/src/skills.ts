/**
 * Skills, as the user sees them in the sidebar: how Amuse does a kind of
 * work, written down. Built-in ones ship with Amuse; the user's own live in
 * skills/ of the workspace (theirs, installed, or written by Amuse), and one
 * of theirs replaces a built-in one of the same name.
 */
import { z } from "zod";

export const SkillOrigin = z.enum(["built-in", "yours"]);
export type SkillOrigin = z.infer<typeof SkillOrigin>;

export const SkillInfo = z.object({
  name: z.string(),
  /** what it covers and when Amuse reads it */
  description: z.string(),
  origin: SkillOrigin,
  /** a built-in one the user's own of the same name replaces */
  replaced: z.boolean(),
});
export type SkillInfo = z.infer<typeof SkillInfo>;
