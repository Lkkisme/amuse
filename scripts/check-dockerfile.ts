/** Every workspace the runtime needs must be copied into the image (web ships as its build). */
import { readFileSync } from "node:fs";

const workspaces: string[] = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).workspaces;
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const missing = workspaces.filter(
  (w) => !dockerfile.includes(`COPY ${w}/package.json ${w}/`) || (w !== "web" && !dockerfile.includes(`COPY ${w} ${w}`)),
);
if (missing.length) {
  console.error(`Dockerfile does not copy: ${missing.join(", ")}`);
  process.exit(1);
}
