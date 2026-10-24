/**
 * The Vault's import: keys.json, models.json and sandbox-secrets.json become rows, with every secret sealed; the files that
 * held secrets in the open are deleted once the import is checked, and only sealed copies of them are kept, in the database.
 * The work is in src/legacy/vault.ts.
 */
import type { Context, Finish } from "../src/migrations.ts";
import { describeVault, importVault } from "../src/legacy/vault.ts";

export const describe = (context: Omit<Context, "db">): string[] => describeVault(context);
export const up = (context: Context): Finish => importVault(context);
// no `down`: to go back, restore the old files from their sealed copies (amuse-admin restore-secret-files) and delete the database
