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

/** `text` with every value in `secrets` (the longest first, so one inside another goes whole) shown as its name. */
export function mask(text: string, secrets: readonly Masked[]): string {
  let out = text;
  for (const { name, value } of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    // a value too short to be one would mask ordinary words
    if (value.length >= 6) out = out.split(value).join(`\u2039${name}\u203a`);
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
