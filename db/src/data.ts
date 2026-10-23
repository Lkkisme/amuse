import { fileURLToPath } from "node:url";

/** The folder with this build's migrations (db/migrations/): SQL and TypeScript, one sequence. */
export const dataMigrations = fileURLToPath(new URL("../migrations/", import.meta.url));
