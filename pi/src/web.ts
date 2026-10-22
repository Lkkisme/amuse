/**
 * Looking things up without a browser: a web search, and reading a page as
 * text. Much lighter than a browser run, for when nothing on a page needs
 * doing. Both keep to the user's rules for visiting (core/policy.ts): a site
 * they say no to is neither shown in results nor read (reading it is a refusal
 * by their rule: recorded, and the agent told which rule); one the rules leave
 * to ask is read only once the user allows it (the agent asks, and gets the
 * page later). Reading refuses anything that is not the public
 * web: the server can reach places the user's browser cannot (this machine,
 * its private networks), and a page could talk the agent into asking for
 * them. Every redirect is checked again. What comes back is the web's, so it
 * is handed to the agent as untrusted.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type BrowserRules, type RuleSource, type Rules, browserRulesOf, decideBrowser, hostOf } from "@amuse/core";
import { Type } from "typebox";
import { status } from "./status.ts";
import { untrusted } from "./untrusted.ts";
import { askToVisit, notVisited, refuseByRule, visitAnswer } from "./visits.ts";
import type { Hold } from "./runs.ts";

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

/**
 * A read: the page as text (or why there is none), a site the user must allow first (`ask`), or a refusal by a rule of theirs
 * (`refused`: with the rule, to tell the agent and to record).
 */
export type Read = { kind: "text"; text: string } | { kind: "ask"; url: string } | { kind: "refused"; url: string; source: RuleSource };

/** Why a URL may not be read, or null when it may; `ask` when its site needs the user's leave and has not got it. */
async function refusal(url: string, rules: Rules, granted: ReadonlySet<string>): Promise<Read | null> {
  const site = hostOf(url);
  if (!site) return { kind: "text", text: `"${url}" is not an http(s) address.` };
  const { permission, source } = decideBrowser(await browserRulesOf(rules), url, "visit");
  if (permission === "deny") return { kind: "refused", url, source };
  // what is not the public web is never read, so the user is not even asked about it
  const refused = await unreachable(url);
  if (refused !== null) return { kind: "text", text: refused };
  return permission === "ask" && !granted.has(site) ? { kind: "ask", url } : null;
}

/** Why a URL is not on the public web, or null when it is. */
async function unreachable(url: string): Promise<string | null> {
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

/** Read a page as text, following redirects only to places it may go; `granted`: sites the user allowed for this read. */
export async function readPage(url: string, rules: Rules, http: typeof fetch = fetch, granted: ReadonlySet<string> = new Set()): Promise<Read> {
  const page = (text: string): Read => ({ kind: "text", text });
  let at = url;
  for (let hop = 0; hop <= REDIRECTS; hop++) {
    const refused = await refusal(at, rules, granted);
    if (refused) return refused;
    const response = await http(at, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (amuse; reading for its user)" } });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      at = new URL(next, at).href;
      continue;
    }
    if (!response.ok) return page(`${hostOf(at)} answered ${response.status}.`);
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/|html|json|xml/.test(type)) return page(`${at} is not a page to read (${type || "unknown type"}).`);
    const body = Buffer.from(await response.arrayBuffer()).subarray(0, READ_LIMIT).toString("utf8");
    const { title, text } = type.includes("html") ? pageText(body) : { title: "", text: body };
    const clipped = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (cut; the page goes on)` : text;
    return page(`URL: ${at}${title ? `\nTitle: ${title}` : ""}\n\n${clipped}`);
  }
  return page("Too many redirects.");
}

const failed = (url: string, e: unknown) => `Could not read ${url}: ${e instanceof Error ? e.message : String(e)}`;

/**
 * Read `url` as the agent's tool does: at once where the rules allow it; for a
 * site with no rule, ask the user and return, reading it in the background once
 * they allow it (the agent gets the page as a report). Returns what the agent is told now.
 */
export async function readForAgent(io: AgentIO, rules: Rules, url: string, http: typeof fetch = fetch, hold?: Hold): Promise<string> {
  const read = await readPage(url, rules, http).catch((e: unknown): Read => ({ kind: "text", text: failed(url, e) }));
  if (read.kind === "text") return untrusted(read.text);
  if (read.kind === "refused") return refuseByRule(io, "visit", hostOf(read.url) ?? read.url, read.source, "Visit", read.url);
  const asked = askToVisit(io, read.url, "To read the page");
  if (!asked.ok) return `Could not ask to visit ${hostOf(read.url)}.`;
  if (hold) {
    // a helper holds here until the user answers, then reads on
    hold.waiting(`to visit ${hostOf(read.url)} (to read ${read.url})`);
    const outcome = await visitAnswer(io, rules, asked.id, read.url);
    hold.working();
    if (outcome !== "approved") return notVisited(read.url, outcome);
    const site = hostOf(read.url);
    const again = await readPage(read.url, rules, http, new Set(site ? [site] : [])).catch((e: unknown): Read => ({ kind: "text", text: failed(read.url, e) }));
    return again.kind === "text" ? untrusted(again.text) : onward(io, again);
  }
  void visitAnswer(io, rules, asked.id, read.url).then(async (outcome) => {
    if (outcome !== "approved") return io.report(`[page not read] ${notVisited(read.url, outcome)}`);
    const site = hostOf(read.url);
    const again = await readPage(read.url, rules, http, new Set(site ? [site] : [])).catch((e: unknown): Read => ({ kind: "text", text: failed(read.url, e) }));
    io.report(again.kind === "text" ? `[page read: ${read.url}]\n${untrusted(again.text)}` : `[page not read] ${onward(io, again)}`);
  });
  return `The user is asked first about visiting ${hostOf(read.url)}. If they allow it, the page is read in the background and you get it as a report. Tell the user briefly that you need their OK.`;
}

/** A page led on to a site that needs the user's say first (or whose rule says no): what the agent is told. */
function onward(io: AgentIO, to: Exclude<Read, { kind: "text" }>): string {
  const where = hostOf(to.url) ?? to.url;
  return to.kind === "refused"
    ? `It led on to ${where}. ${refuseByRule(io, "visit", where, to.source, "Visit", to.url)}`
    : `It led on to ${where}, which needs the user's permission too; read that address to ask for it.`;
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: null });

/** The results the rules allow showing: a site they say no to is not even shown; one they leave to ask is (reading it asks first). */
export const visible = (results: SearchResult[], rules: BrowserRules): SearchResult[] => results.filter((r) => decideBrowser(rules, r.url, "visit").permission !== "deny");

/** web_read always; web_search where a search is configured. */
export function webTools(io: () => AgentIO, rules: Rules, search: Search | undefined, hold?: Hold): ToolDefinition[] {
  const read = defineTool({
    name: "web_read",
    label: "Read a web page",
    description: "Read a public web page as text, without a browser: quick, for looking things up. Use browse instead when something on the page has to be done (log in, fill, click).",
    parameters: Type.Object({ status, url: Type.String({ description: "Absolute http(s) URL" }) }),
    execute: async (_, { url }) => text(await readForAgent(io(), rules, url, fetch, hold)),
  });
  if (!search) return [read];
  const find = defineTool({
    name: "web_search",
    label: "Search the web",
    description: "Search the web; returns titles, links and snippets. Read a result with web_read.",
    parameters: Type.Object({ status, query: Type.String() }),
    async execute(_, { query }) {
      const results = visible(await search(query), await browserRulesOf(rules));
      if (results.length === 0) return text(`No results for "${query}".`);
      return text(untrusted(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n")));
    },
  });
  return [find, read];
}
