/**
 * The browser's rules (core/policy.ts) as the agents meet them. Visiting a
 * site the rules leave to ask is an approval card; an answer for good becomes
 * the site's rule for that action (visiting allowed, or the site never
 * visited). A rule that says no is a hard no: nothing is asked, the refusal is
 * recorded where the user can see it (their Approvals list), and the agent is
 * told which rule it was and where to change it, and not to work around it.
 */
import { type Acted, type AgentIO, type Outcome, type RuleSource, type Rules, ruleSaid, ruleWhere, siteOf, siteRuleFor } from "@amuse/core";
import type { BrowserAction } from "@amuse/protocol";

/** Post the card asking whether `url`'s site may be visited, and what for. */
export function askToVisit(io: AgentIO, url: string, why: string): Acted {
  return io.act({ kind: "ask", action: "Visit", target: siteOf(url) ?? url, detail: `${url}\n${why}`, remember: true });
}

/** The user's answer to a card about `action` at `url`; one meant for good is kept as the site's rule for that action. */
export async function answered(io: AgentIO, rules: Rules, id: string, url: string, action: BrowserAction): Promise<Outcome> {
  const { verdict, remember } = await io.decision(id);
  const site = siteOf(url);
  if (remember && site && verdict !== "timed_out") {
    const rule = siteRuleFor(action, verdict === "approved");
    await rules.setSiteAction(site, rule.action, rule.permission).catch(() => {});
  }
  return verdict;
}

/** The user's answer to a visit card. */
export const visitAnswer = (io: AgentIO, rules: Rules, id: string, url: string): Promise<Outcome> => answered(io, rules, id, url, "visit");

/** What the agent is told when a visit was not allowed. */
export const notVisited = (url: string, outcome: Exclude<Outcome, "approved">) =>
  outcome === "denied"
    ? `The user did not allow visiting ${siteOf(url) ?? url}. Do not try to reach it another way.`
    : `The user did not answer about visiting ${siteOf(url) ?? url} in time, so it was not visited.`;

const doing: Record<BrowserAction, string> = { visit: "visiting", submit: "submitting forms on", download: "downloading files from", upload: "uploading files to" };

/**
 * A rule said no to `action` at `target` (a site): record it for the user (a refusal by their rule, not an answer), and say what
 * the agent is told. `title` is what was refused, as the user would say it; `more` goes on the record.
 */
export function refuseByRule(io: AgentIO, action: BrowserAction, target: string, source: RuleSource, title: string, more = ""): string {
  io.act({ kind: "refuse", action: title, target, detail: [ruleSaid(source, action).replace(/^./, (c) => c.toUpperCase()), more].filter(Boolean).join("\n") });
  return `Refused by ${ruleSaid(source, action)}: ${doing[action]} ${target} is not allowed. Nothing was asked. Do not work around it (another tool, another way in, the browser) and do not ask again unless the user brings it up. Tell the user in one line which rule it is and that they can change it in ${ruleWhere(source)}.`;
}
