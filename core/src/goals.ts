/**
 * The goals' files (protocol goals.ts), read as the user or Amuse left them:
 * memory/goals/<id>/GOAL.md opens with front matter (title, status, added),
 * then what the goal is and where it stands; log.md has a note under each
 * "## YYYY-MM-DD …" heading, oldest first. What is missing reads leniently:
 * the folder's name for a title, active for a status.
 */
import { type Goal, type GoalNote, GoalStatus } from "@amuse/protocol";
import { type Workspace, WorkspaceError } from "./host.ts";

export const GOALS = "memory/goals";
const goalFile = (id: string) => `${GOALS}/${id}/GOAL.md`;
const logFile = (id: string) => `${GOALS}/${id}/log.md`;

async function read(files: Workspace, path: string): Promise<string | null> {
  if (!(await files.exists(path))) return null;
  return new TextDecoder().decode((await files.open(path)).data);
}
const write = (files: Workspace, path: string, content: string) => files.write(path, new TextEncoder().encode(content), true);

/** A goal's id names one folder in memory/goals/, and nothing else. */
const sound = (id: string) => /^[^/\\]+$/.test(id) && id !== "." && id !== "..";

const FRONT = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/** Front matter's fields (keys in lower case) and what follows it. */
function split(source: string): { fields: Map<string, string>; body: string } {
  const match = source.match(FRONT);
  const fields = new Map<string, string>();
  for (const line of (match?.[1] ?? "").split("\n")) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field?.[1]) fields.set(field[1].toLowerCase(), (field[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return { fields, body: (match ? (match[2] ?? "") : source).trim() };
}

/** `source` with front matter field `key` set to `value` (added, or front matter made, when missing). */
function setField(source: string, key: string, value: string): string {
  const match = source.match(FRONT);
  if (!match) return `---\n${key}: ${value}\n---\n\n${source.trim()}\n`;
  const lines = (match[1] ?? "").split("\n");
  const at = lines.findIndex((l) => l.toLowerCase().startsWith(`${key}:`));
  if (at >= 0) lines[at] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  const body = (match[2] ?? "").trim();
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}\n` : ""}`;
}

/** A log's notes, newest first: the day each heading starts with, the rest of the heading, and what is under it. */
export function parseLog(source: string): GoalNote[] {
  return source
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading = "", ...rest] = section.split("\n");
      const day = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
      const label = heading
        .replace(day, "")
        .replace(/^[\s·:\-–—]+/, "")
        .trim();
      return { day, label, text: rest.join("\n").trim() };
    })
    .reverse();
}

/** The goal in memory/goals/<id>/; null when there is none. */
export async function readGoal(files: Workspace, id: string): Promise<Goal | null> {
  if (!sound(id)) return null;
  const source = await read(files, goalFile(id));
  if (source === null) return null;
  const { fields, body } = split(source);
  const status = GoalStatus.safeParse(fields.get("status"));
  const log = await read(files, logFile(id));
  return {
    id,
    title: fields.get("title") || body.match(/^# (.+)$/m)?.[1]?.trim() || id,
    status: status.success ? status.data : "active",
    added: fields.get("added") ?? "",
    about: body,
    latest: (log === null ? [] : parseLog(log))[0] ?? null,
  };
}

/** A goal's log, newest first. */
export async function goalLog(files: Workspace, id: string): Promise<GoalNote[]> {
  const log = sound(id) ? await read(files, logFile(id)) : null;
  return log === null ? [] : parseLog(log);
}

/** Every goal: the active ones first, then the newest. */
export async function listGoals(files: Workspace): Promise<Goal[]> {
  if (!(await files.exists(GOALS))) return [];
  const folders = (await files.list(GOALS)).filter((e) => e.kind === "folder");
  const goals = (await Promise.all(folders.map((f) => readGoal(files, f.path.slice(GOALS.length + 1))))).filter((g) => g !== null);
  const rank = (g: Goal) => (g.status === "active" ? 0 : 1);
  return goals.sort((a, b) => rank(a) - rank(b) || b.added.localeCompare(a.added) || a.title.localeCompare(b.title));
}

/** A folder name from a title, in the title's own script ("Learn Japanese" → learn-japanese). */
const slug = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "goal";

/** Add a goal on `day` (the user's). */
export async function addGoal(files: Workspace, goal: { title: string; about: string }, day: string): Promise<Goal> {
  const base = slug(goal.title);
  let id = base;
  for (let n = 2; await files.exists(`${GOALS}/${id}`); n++) id = `${base}-${n}`;
  const title = goal.title.trim().replace(/\s+/g, " ");
  await write(files, goalFile(id), `---\ntitle: ${title}\nstatus: active\nadded: ${day}\n---\n\n${goal.about.trim()}\n`);
  const added = await readGoal(files, id);
  if (!added) throw new WorkspaceError(`the goal ${title} could not be kept`);
  return added;
}

/** Close a goal on `day`: reached (done) or let go of (dropped), said in its log. */
export async function closeGoal(files: Workspace, id: string, status: "done" | "dropped", day: string): Promise<void> {
  const source = sound(id) ? await read(files, goalFile(id)) : null;
  if (source === null) throw new WorkspaceError("that goal is not there any more");
  await write(files, goalFile(id), setField(setField(source, "status", status), "closed", day));
  const log = (await read(files, logFile(id))) ?? "# Log\n";
  await write(files, logFile(id), `${log.replace(/\n*$/, "\n")}\n## ${day} · ${status === "done" ? "Reached" : "Let go"}\nClosed by the user.\n`);
}
