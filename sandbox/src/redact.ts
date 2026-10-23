/**
 * The sandbox as the agent sees it: everything it says comes back with the
 * secrets the user gave for it masked ([secret: name]), so a command that prints
 * one does not put it in the agent's context, the chat or memory. This keeps
 * them from showing by accident; it does not hide them from what runs there.
 */
import { type SandboxClient, SandboxError } from "./client.ts";

/** A secret to mask: its value, and the name it is shown by (the entry and the field: "Cloudflare token"). */
export interface Masked {
  name: string;
  value: string;
}

/** What a terminal may put inside a value as it shows it: a line break where the screen wrapped it, or a code that colours or moves what is shown. */
const CODE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r|\n/y;

/** `text` without those, and where each character left came from in it. */
function stripped(text: string): { plain: string; from: number[] } {
  let plain = "";
  const from: number[] = [];
  for (let at = 0; at < text.length; ) {
    CODE.lastIndex = at;
    if (CODE.test(text)) {
      at = CODE.lastIndex;
      continue;
    }
    plain += text[at];
    from.push(at);
    at++;
  }
  return { plain, from };
}

/**
 * `text` with every value in `secrets` (the longest first, so one inside another goes whole) shown as its name, even
 * where a terminal wrapped it over lines or coloured part of it. Found by plain search on the text with those taken
 * out, so how long it takes grows with the text, whatever the text is.
 */
export function mask(text: string, secrets: readonly Masked[]): string {
  const { plain, from } = stripped(text);
  /** what is replaced: [start, end) in `text`, and by what */
  const found: { start: number; end: number; name: string }[] = [];
  const taken = (start: number, end: number) => found.some((f) => start < f.end && f.start < end);
  for (const { name, value } of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    const sought = stripped(value).plain;
    // a value too short to be one would mask ordinary words
    if (sought.length < 6) continue;
    for (let at = plain.indexOf(sought); at >= 0; at = plain.indexOf(sought, at + sought.length)) {
      const start = from[at] ?? 0;
      const end = (from[at + sought.length - 1] ?? start) + 1;
      if (!taken(start, end)) found.push({ start, end, name });
    }
  }
  let out = "";
  let at = 0;
  for (const { start, end, name } of found.sort((a, b) => a.start - b.start)) {
    out += `${text.slice(at, start)}[secret: ${name}]`;
    at = end;
  }
  return out + text.slice(at);
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
