/**
 * Migration 1's second half: the journal and the JSON files beside it become rows (chats, rules, access, defaults,
 * the sent index), and the old files are renamed to .bak once the import has been checked. The work is in
 * src/legacy/import.ts. The keys, the model choice and the sandbox's secrets are not here: see the Secret store's migration.
 */
import type { Context, Finish } from "../src/migrations.ts";
import { describeLegacy, importLegacy } from "../src/legacy/import.ts";

export const describe = (context: Omit<Context, "db">): string[] => describeLegacy(context);
export const up = (context: Context): Finish => importLegacy(context);
// no `down`: the old files are kept as <name>.bak; to go back, rename them and delete the database
