/**
 * Files kept in the workspace for the user, apart from what the agent writes for itself: what a page
 * downloaded (downloads/), and a picture of a page (screenshots/). Each is named so the user can read
 * it, and none is ever written over something that is there.
 */
import type { Workspace } from "@amuse/core";
import { extname } from "node:path";

/**
 * Where a file named `name` can be kept in `folder`: that name, or "name (2).ext" and so on if it is taken. Something the
 * workspace will not look at (a link planted in the place) is as taken as a file: the next name is tried, and the rest of what
 * is being kept goes on. After a good many names it gives up and returns the last, whose write then fails on its own.
 */
export async function freePath(workspace: Workspace, folder: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let path = `${folder}/${name}`;
  for (let n = 2; n < 1000 && (await workspace.exists(path).catch(() => true)); n++) path = `${folder}/${stem} (${n})${ext}`;
  return path;
}

/** Characters of a title kept in a file's name. */
const nameLimit = 60;

/** A title as part of a file name: its own words in lower case, a dash for each run of what a name cannot hold. */
export function slug(title: string): string {
  const words = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
  return words.slice(0, nameLimit).replace(/[.-]+$/, "") || "page";
}

/** A picture's file name: what it is of, and when it was taken. */
export function pictureName(title: string, at: Date): string {
  const time = at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${slug(title)}-${time}.png`;
}

/** Keep `png` as a picture of `title`; its path, or null when there is nowhere to keep it or it could not be written. */
export async function keepPicture(files: Workspace | undefined, title: string, png: Uint8Array | null, at: Date): Promise<string | null> {
  if (!files || !png) return null;
  try {
    const path = await freePath(files, "screenshots", pictureName(title, at));
    await files.write(path, png, false);
    return path;
  } catch {
    return null;
  }
}
