/**
 * Looking things up without a browser: a web search, and reading a page as
 * text. Much lighter than a browser run, for when nothing on a page needs
 * doing. Both keep to the user's site rules (a denied site is neither shown
 * in results nor read), and reading refuses anything that is not the public
 * web: the server can reach places the user's browser cannot (this machine,
 * its private networks), and a page could talk the agent into asking for
 * them. Every redirect is checked again. What comes back is the web's, so it
 * is handed to the agent as untrusted.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type Rules, siteOf, sitePermission } from "@remuse/core";
import { Type } from "typebox";
import { status } from "./status.ts";
import { untrusted } from "./untrusted.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** A web search, where one is configured. */
export type Search = (query: string) => Promise<SearchResult[]>;

const READ_LIMIT = 2_000_000; // bytes of a page read at most
const TEXT_LIMIT = 20_000; // characters of it given to the agent
const REDIRECTS = 5;

/** Addresses that are not the public internet: this machine, private and link-local networks, CGNAT (Tailscale), multicast. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return privateAddress(mapped);
    return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Why a URL may not be read, or null when it may. */
async function refusal(url: string, rules: Rules): Promise<string | null> {
  const site = siteOf(url);
  if (!site) return `"${url}" is not an http(s) address.`;
  if (sitePermission(await rules.sites(), url) === "deny") return `The user does not allow ${site}. Do not try to reach it another way.`;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && isIP(host) === 0) return `${host} is not on the public web.`;
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) return `${host} could not be found.`;
  if (addresses.some(privateAddress)) return `${host} is not on the public web.`;
  return null;
}

/** Readable text of an HTML page: no scripts, styles or tags; entities decoded; whitespace folded. */
export function pageText(html: string): { title: string; text: string } {
  const decode = (s: string) =>
    s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const text = decode(
    html
      .replace(/<(script|style|noscript|template|svg|head|title)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|tr|h[1-6]|section|article|header|footer)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { title, text };
}

/** Read a page as text, following redirects only to places it may go. */
export async function readPage(url: string, rules: Rules, http: typeof fetch = fetch): Promise<string> {
  let at = url;
  for (let hop = 0; hop <= REDIRECTS; hop++) {
    const refused = await refusal(at, rules);
    if (refused) return refused;
    const response = await http(at, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (remuse; reading for its user)" } });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      at = new URL(next, at).href;
      continue;
    }
    if (!response.ok) return `${siteOf(at)} answered ${response.status}.`;
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/|html|json|xml/.test(type)) return `${at} is not a page to read (${type || "unknown type"}).`;
    const body = Buffer.from(await response.arrayBuffer()).subarray(0, READ_LIMIT).toString("utf8");
    const { title, text } = type.includes("html") ? pageText(body) : { title: "", text: body };
    const clipped = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (cut; the page goes on)` : text;
    return `URL: ${at}${title ? `\nTitle: ${title}` : ""}\n\n${clipped}`;
  }
  return "Too many redirects.";
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });

/** web_read always; web_search where a search is configured. */
export function webTools(rules: Rules, search: Search | undefined): ToolDefinition[] {
  const read = defineTool({
    name: "web_read",
    label: "Read a web page",
    description: "Read a public web page as text, without a browser: quick, for looking things up. Use browse instead when something on the page has to be done (log in, fill, click).",
    parameters: Type.Object({ status, url: Type.String({ description: "Absolute http(s) URL" }) }),
    execute: async (_, { url }) => text(untrusted(await readPage(url, rules).catch((e: unknown) => `Could not read ${url}: ${e instanceof Error ? e.message : String(e)}`))),
  });
  if (!search) return [read];
  const find = defineTool({
    name: "web_search",
    label: "Search the web",
    description: "Search the web; returns titles, links and snippets. Read a result with web_read.",
    parameters: Type.Object({ status, query: Type.String() }),
    async execute(_, { query }) {
      const sites = await rules.sites();
      const results = (await search(query)).filter((r) => sitePermission(sites, r.url) !== "deny");
      if (results.length === 0) return text(`No results for "${query}".`);
      return text(untrusted(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n")));
    },
  });
  return [find, read];
}
