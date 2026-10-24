/**
 * Telling a provider where to cache. Pi marks the system prompt, the last tool and the last message of a request
 * (Anthropic's `cache_control`, and OpenRouter's for Anthropic models), but the conversation is one user message,
 * of which only the end is marked, and that end is new every turn. So the part of the message that holds still
 * between turns is cut into blocks and given a mark of its own: a request then reads back the cache up to where
 * the last one agreed with it, and writes on from there. A provider that caches by itself (OpenAI, by prefix)
 * needs nothing of this, and is left as it is.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A request may carry this many marks (Anthropic's limit). */
const MARKS = 4;

/** The marks a request holds already (what each `cache_control` says). */
function marksIn(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(marksIn);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => (key === "cache_control" ? [inner] : marksIn(inner)));
}

/**
 * The content of the first user message cut at `parts` (what it begins with, in order), the last of them
 * marked with `mark`; null if it does not begin with them, or they are all there is of it.
 */
function cut(content: unknown, parts: string[], mark: unknown): unknown[] | null {
  const first = Array.isArray(content) ? content[0] : content;
  // Pi sends a message as its text, or as blocks: the text first, then pictures
  const block = isRecord(first) && first["type"] === "text" ? first : null;
  const text = typeof first === "string" ? first : typeof block?.["text"] === "string" ? block["text"] : null;
  if (text === null) return null;
  const stable = parts.join("");
  if (!text.startsWith(stable) || text.length === stable.length) return null;
  // a mark the text had at its end stays at its end
  const closing = block?.["cache_control"];
  const blocks = parts.map((text, i) => ({ type: "text", text, ...(i === parts.length - 1 ? { cache_control: mark } : {}) }));
  const rest = { type: "text", text: text.slice(stable.length), ...(closing === undefined ? {} : { cache_control: closing }) };
  return [...blocks, rest, ...(Array.isArray(content) ? content.slice(1) : [])];
}

/**
 * `payload`, a provider request, with the first user message cut at `parts` and a cache mark after them, where the
 * request is marked for caching at all and has a mark to spare. Anything else comes back as it is.
 */
export function markPrefix(payload: unknown, parts: string[]): unknown {
  if (!isRecord(payload) || !Array.isArray(payload["messages"]) || parts.length === 0) return payload;
  const held = marksIn(payload);
  const mark = held[0];
  if (mark === undefined || held.length >= MARKS) return payload;
  const messages: unknown[] = payload["messages"];
  const at = messages.findIndex((m) => isRecord(m) && m["role"] === "user");
  const message = messages[at];
  if (!isRecord(message)) return payload;
  const content = cut(message["content"], parts, mark);
  if (content === null) return payload;
  return { ...payload, messages: messages.map((m, i) => (i === at ? { ...message, content } : m)) };
}
