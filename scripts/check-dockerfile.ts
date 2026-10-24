/** Every workspace the runtime needs must be copied into the image (web ships as its build), and the files it reads beside them. */
import { readFileSync } from "node:fs";

/** Files beside the workspaces that the runtime reads from the image (the changelog tells the user what an update brought). */
const files = ["CHANGELOG.md"];

const workspaces: string[] = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).workspaces;
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const missing = [
  ...workspaces.filter((w) => !dockerfile.includes(`COPY ${w}/package.json ${w}/`) || (w !== "web" && !dockerfile.includes(`COPY ${w} ${w}`))),
  ...files.filter((f) => !dockerfile.includes(`COPY ${f} ${f}`)),
];
if (missing.length) {
  console.error(`Dockerfile does not copy: ${missing.join(", ")}`);
  process.exit(1);
}
