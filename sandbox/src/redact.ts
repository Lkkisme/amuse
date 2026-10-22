/**
 * The sandbox as the agent sees it: everything it says comes back with the
 * credentials the user gave for it masked (‹NAME›), so a command that prints
 * one does not put it in the agent's context, the chat or memory. This keeps
 * them from showing by accident; it does not hide them from what runs there.
 */
import { type SandboxClient, SandboxError } from "./client.ts";

/** A credential to mask: its value, and the name it is shown by. */
export interface Masked {
  name: string;
  value: string;
}

/**
 * What may come between a value's characters as a terminal shows it: a line break where the screen wrapped it (a
 * terminal's reading of its screen, herdr's, keeps those), and the codes that colour or move what is shown.
 */
const GAP = String.raw`(?:\r|\n|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))*`;
/** Each value's pattern, made once (a value can be long). */
const patterns = new Map<string, RegExp>();
const patternOf = (value: string) => {
  let pattern = patterns.get(value);
  if (!pattern) {
    pattern = new RegExp(value.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")).join(GAP), "g");
    if (patterns.size > 200) patterns.clear();
    patterns.set(value, pattern);
  }
  return pattern;
};

/** `text` with every value in `secrets` (the longest first, so one inside another goes whole) shown as its name, even wrapped over lines. */
export function mask(text: string, secrets: readonly Masked[]): string {
  let out = text;
  for (const { name, value } of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    // a value too short to be one would mask ordinary words
    if (value.length >= 6) out = out.replace(patternOf(value), () => `\u2039${name}\u203a`);
  }
  return out;
}

/** `client`, every word it brings back masked with what `secrets` gives at that moment. */
export function masking(client: SandboxClient, secrets: () => readonly Masked[]): SandboxClient {
  const clean = (text: string) => mask(text, secrets());
  const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof SandboxError) throw new SandboxError(clean(error.message), error.detail === undefined ? undefined : clean(error.detail));
      throw error;
    }
  };
  return {
    ...client,
    run: (request, signal) =>
      guarded(async () => {
        const ran = await client.run(request, signal);
        return { ...ran, output: clean(ran.output) };
      }),
  };
}
