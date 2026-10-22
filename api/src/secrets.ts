/**
 * Credentials the user gave for the sandbox: kept here, in a file of the
 * server's (0600, beside the keys; a value is never sent back), given to the
 * sandbox as each request said, given again after a reset (which empties its
 * home), and masked in all the sandbox says to the agent (@amuse/sandbox's
 * `masking`), so none shows by accident in the chat, the agent's context or
 * memory. What runs in the sandbox can read them: they are for it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Rejected } from "@amuse/core";
import { type SecretInfo, SecretDestination, type SecretRequest } from "@amuse/protocol";
import { type Masked, SandboxError, type SandboxClient } from "@amuse/sandbox";
import { z } from "zod";

const Kept = z.object({ id: z.string(), name: z.string(), deliver: SecretDestination, at: z.string(), value: z.string() });
type Kept = z.infer<typeof Kept>;

/** What the sandbox could not do, in our words (never what it said). */
const worded = (error: unknown) => (error instanceof SandboxError ? new Rejected({ kind: "unsound", reason: error.message }) : error);

/** The same place: one variable, one file (a code typed into a terminal is never the same as another). */
const samePlace = (a: SecretDestination, b: SecretDestination) =>
  (a.kind === "env" && b.kind === "env" && a.name === b.name) || (a.kind === "file" && b.kind === "file" && a.path === b.path);

export function sandboxSecrets(path: string, sandbox: SandboxClient, now: () => string = () => new Date().toISOString()) {
  const read = (): Kept[] => {
    if (!existsSync(path)) return [];
    const parsed = z.array(Kept).safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : [];
  };
  const write = (all: Kept[]) => writeFileSync(path, JSON.stringify(all, null, 2), { mode: 0o600 });

  /** Put `value` where `deliver` says. */
  const place = async (deliver: SecretDestination, value: string) => {
    if (deliver.kind === "env") await sandbox.setEnv({ name: deliver.name, value });
    else if (deliver.kind === "file") await sandbox.setFile({ path: deliver.path, value });
    else
      await sandbox.typeSecret({ pane: deliver.pane, value }).catch((error: unknown) => {
        // the likely why, in words: what waited for it has ended, or the terminal is gone
        throw error instanceof SandboxError
          ? new SandboxError(`Nothing in terminal ${deliver.pane} is waiting for it now (what asked may have ended, or the terminal is closed). Ask Amuse to start it again.`)
          : error;
      });
  };

  return {
    /** What to mask, and by which name. */
    masked: (): Masked[] => read().map((k) => ({ name: k.deliver.kind === "env" ? k.deliver.name : k.name, value: k.value })),

    async give(request: SecretRequest, value: string): Promise<void> {
      try {
        await place(request.deliver, value);
      } catch (error) {
        throw worded(error);
      }
      // a new one for the same place replaces the old
      write([
        ...read().filter((k) => !samePlace(k.deliver, request.deliver)),
        { id: request.id, name: request.name, deliver: request.deliver, at: now(), value },
      ]);
    },

    secrets: async (): Promise<SecretInfo[]> => read().map(({ id, name, deliver, at }) => ({ id, name, deliver, at })),

    async forget(id: string): Promise<void> {
      const all = read();
      const kept = all.find((k) => k.id === id);
      if (!kept) throw new Rejected({ kind: "unsound", reason: "That credential is not there any more." });
      try {
        if (kept.deliver.kind === "env") await sandbox.forget({ env: kept.deliver.name });
        else if (kept.deliver.kind === "file") await sandbox.forget({ file: kept.deliver.path });
      } catch (error) {
        throw worded(error);
      }
      write(all.filter((k) => k.id !== id));
    },

    /** After a reset emptied the sandbox's home: the variables and files again (a code typed into a terminal was for it alone). */
    async again(): Promise<void> {
      for (const k of read()) if (k.deliver.kind !== "stdin") await place(k.deliver, k.value).catch(() => {});
    },
  };
}
