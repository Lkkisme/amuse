/**
 * Skills: how to do a kind of work well, written down, read when the work
 * comes up rather than told every turn. Each is a folder with a SKILL.md
 * (the usual format: front matter with `name` and `description`, then the
 * instructions), so skills from elsewhere drop in as they are. Built-in ones
 * ship with Amuse (pi/skills/); the user's own live in the workspace
 * (skills/), where they and Amuse add to them, and one of the user's
 * replaces a built-in one of the same name. Every turn gets the list, a line
 * a skill; `use_skill` reads one in full.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "@amuse/core";
import { Type } from "typebox";
import { status } from "./status.ts";

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** where it comes from: built in, or its folder in the workspace */
  from: string;
}

/** Where the user's skills live in the workspace. */
export const SKILLS = "skills";
/** The built-in skills' folder. */
const builtInDir = fileURLToPath(new URL("../skills", import.meta.url));

/** A SKILL.md as a skill: its front matter's name and description, and the rest; null when it has neither. */
export function parseSkill(source: string, from: string, fallbackName: string): Skill | null {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const front = match?.[1] ?? "";
  const field = (key: string) =>
    front
      .match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
      ?.trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  const description = field("description");
  if (!description) return null;
  return { name: field("name") || fallbackName, description, body: (match?.[2] ?? source).trim(), from };
}

/** The skills that ship with Amuse, read once. */
export function builtInSkills(dir = builtInDir): Skill[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name, "SKILL.md");
    if (!entry.isDirectory() || !existsSync(file)) return [];
    const skill = parseSkill(readFileSync(file, "utf8"), "built in", entry.name);
    return skill ? [skill] : [];
  });
}

/** The user's skills, as they are now: skills/<name>/SKILL.md in the workspace. */
export async function userSkills(files: Workspace): Promise<Skill[]> {
  if (!(await files.exists(SKILLS))) return [];
  const found = await Promise.all(
    (await files.list(SKILLS))
      .filter((e) => e.kind === "folder")
      .map(async (folder) => {
        const path = `${folder.path}/SKILL.md`;
        if (!(await files.exists(path))) return null;
        const source = new TextDecoder().decode((await files.open(path)).data);
        return parseSkill(source, folder.path, folder.path.slice(SKILLS.length + 1));
      }),
  );
  return found.filter((s) => s !== null);
}

/** Every skill there is, the user's replacing built-in ones of the same name, by name. */
export async function allSkills(builtIn: Skill[], files: Workspace | undefined): Promise<Skill[]> {
  const mine = files ? await userSkills(files).catch(() => []) : [];
  const byName = new Map(builtIn.map((s) => [s.name, s]));
  for (const s of mine) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The list every turn gets. */
export function catalog(skills: Skill[]): string {
  if (skills.length === 0) return "";
  return [
    "Skills: how to do a kind of work well. Before you do what one covers, read it with `use_skill` (once a conversation is enough, unless it changed). The user's own are in skills/ of the workspace; you may add one there (a folder with a SKILL.md, front matter name and description) when they ask, or to keep a way of working they want repeated.",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}

type Text = { content: { type: "text"; text: string }[]; details: null };
const say = (text: string): Text => ({ content: [{ type: "text", text }], details: null });

/** Reading a skill. */
export function skillTools(builtIn: Skill[], files: Workspace | undefined): ToolDefinition[] {
  return [
    defineTool({
      name: "use_skill",
      label: "Read up",
      description: "Read a skill in full (by its name, from the list of skills), before doing the work it covers.",
      parameters: Type.Object({ status, name: Type.String() }),
      async execute(_, { name }) {
        const skills = await allSkills(builtIn, files);
        const skill = skills.find((s) => s.name === name.trim());
        if (!skill) return say(`There is no skill "${name}". There are: ${skills.map((s) => s.name).join(", ") || "none"}.`);
        const more = skill.from === "built in" ? "" : `\n\n(Its folder is ${skill.from}; other files in it can be read with read_file.)`;
        return say(`# ${skill.name}\n\n${skill.body}${more}`);
      },
    }),
  ];
}
