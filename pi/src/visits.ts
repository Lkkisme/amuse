/**
 * Asking the user before an agent goes to a site they have no rule for
 * (core/policy.ts: unlisted sites are not visited until allowed). The ask is
 * an approval card; an answer for good becomes the site's rule (visiting
 * allowed, acting still asked; or never).
 */
import { type Acted, type AgentIO, type Outcome, type Rules, siteOf, visitRule } from "@amuse/core";

/** Post the card asking whether `url`'s site may be visited, and what for. */
export function askToVisit(io: AgentIO, url: string, why: string): Acted {
  return io.act({ kind: "ask", action: "Visit", target: siteOf(url) ?? url, detail: `${url}\n${why}`, remember: true });
}

/** The user's answer to a visit card; one meant for good is kept as the site's rule. */
export async function visitAnswer(io: AgentIO, rules: Rules, id: string, url: string): Promise<Outcome> {
  const { verdict, remember } = await io.decision(id);
  const site = siteOf(url);
  if (remember && site && verdict !== "timed_out") await rules.setSite(site, visitRule(verdict === "approved")).catch(() => {});
  return verdict;
}

/** What the agent is told when a visit was not allowed. */
export const notVisited = (url: string, outcome: Exclude<Outcome, "approved">) =>
  outcome === "denied"
    ? `The user did not allow visiting ${siteOf(url) ?? url}. Do not try to reach it another way.`
    : `The user did not answer about visiting ${siteOf(url) ?? url} in time, so it was not visited.`;
