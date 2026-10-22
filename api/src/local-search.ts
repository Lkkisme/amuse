/**
 * A private SearXNG instance supplies web_search without a hosted API key.
 * The HTTP API and result processing run locally; SearXNG still sends the
 * query to its configured internet search engines. No model is involved.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Search, SearchResult } from "@amuse/pi";
import { z } from "zod";

const loopbackUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol)
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash;
}, "Search must use an http(s) loopback URL without credentials, query or fragment.");

export const LocalSearchConfigSchema = z.object({
  provider: z.literal("searxng"),
  url: loopbackUrl,
  language: z.string().min(1).max(40).default("all"),
  maxResults: z.number().int().min(1).max(20).default(8),
  timeoutMs: z.number().int().min(1000).max(60000).default(20000),
}).strict();
export type LocalSearchConfig = z.infer<typeof LocalSearchConfigSchema>;

/** Missing means explicitly unconfigured; a broken configuration is not ignored. */
export function loadLocalSearchConfig(path: string): LocalSearchConfig | null {
  if (!existsSync(path)) return null;
  return LocalSearchConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export class LocalSearchUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "LocalSearchUnavailable"; }
}

const Envelope = z.object({
  results: z.array(z.unknown()),
  unresponsive_engines: z.array(z.unknown()).optional(),
});
const Result = z.object({ title: z.string(), url: z.string(), content: z.string().nullish() });
const RESPONSE_LIMIT = 2_000_000;

/** Search snippets sometimes contain emphasis markup; all are untrusted page text. */
function plain(value: string, limit: number): string {
  return value.replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[entity]!)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new LocalSearchUnavailable("Local search returned no response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > RESPONSE_LIMIT) throw new LocalSearchUnavailable("Local search returned an oversized response.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Two requests at most; excess work fails clearly rather than growing an unbounded queue. */
export function createLocalSearch(config: LocalSearchConfig, http: typeof fetch = fetch): Search {
  const chosen = LocalSearchConfigSchema.parse(config);
  const base = chosen.url.endsWith("/") ? chosen.url : `${chosen.url}/`;
  const endpoint = new URL("search", base);
  let active = 0;
  return async (query: string): Promise<SearchResult[]> => {
    const text = query.trim();
    if (!text || text.length > 2048) throw new LocalSearchUnavailable("Search query must contain 1 to 2048 characters.");
    if (active >= 2) throw new LocalSearchUnavailable("Local search is busy with two requests; retry shortly.");
    active++;
    try {
      const response = await http(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ q: text, format: "json", language: chosen.language }),
        redirect: "error",
        signal: AbortSignal.timeout(chosen.timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const detail = response.status === 403 ? " Enable json in SearXNG search.formats." : "";
        throw new LocalSearchUnavailable(`Local search returned HTTP ${response.status}.${detail}`);
      }
      const envelope = Envelope.safeParse(await boundedJson(response));
      if (!envelope.success) throw new LocalSearchUnavailable("Local search returned an unexpected response format.");
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      for (const raw of envelope.data.results) {
        const result = Result.safeParse(raw);
        if (!result.success) continue;
        let url: URL;
        try { url = new URL(result.data.url); } catch { continue; }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
        url.hash = "";
        if (seen.has(url.href)) continue;
        const title = plain(result.data.title, 500);
        if (!title) continue;
        seen.add(url.href);
        results.push({ title, url: url.href, snippet: plain(result.data.content ?? "", 2000) });
        if (results.length >= chosen.maxResults) break;
      }
      if (!results.length && envelope.data.unresponsive_engines?.length) {
        throw new LocalSearchUnavailable("The local search service responded, but its internet search engines failed or blocked this query. Retry later or use the browser.");
      }
      return results;
    } catch (error) {
      if (error instanceof LocalSearchUnavailable) throw error;
      // Do not echo a URL, query, response body, proxy credentials or nested network error.
      throw new LocalSearchUnavailable("Local search could not complete. Check the local SearXNG service and its internet connection.");
    } finally {
      active--;
    }
  };
}

export function localSearchDescription(config: LocalSearchConfig): string {
  return `Web search: local SearXNG (${new URL(config.url).origin}); no Composio key or LLM needed. Search queries go to the configured internet search engines; this is not offline internet search.`;
}
