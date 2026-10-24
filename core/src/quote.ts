/**
 * Replying to an item of Amuse's: what is kept of it with the user's message (a Quote), and how the agent reads it.
 * The quote is made once, when the message is sent, from the item as it was then, so it says the same later, when the
 * item has scrolled out of a client's recent end or out of the agent's context.
 */
import type { Entity, Quote } from "@amuse/protocol";

/** The most of a reply's words a quote keeps. */
const MAX = 300;

const clip = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX ? flat : `${flat.slice(0, MAX - 1)}…`;
};

/** The quote of an item of Amuse's: its words (a reply), or its title and state (a card); null for what is not Amuse's to be replied to. */
export function quoteOf(entity: Entity): Quote | null {
  const { id } = entity;
  switch (entity.kind) {
    case "reply":
      return { id, kind: "reply", text: clip(entity.text) || entity.attachments.map((a) => a.name).join(", "), state: null };
    case "task":
      return { id, kind: "task", text: clip(entity.title), state: entity.status };
    case "approval":
      return { id, kind: "approval", text: clip(`${entity.action} ${entity.target}`), state: entity.status };
    case "connection":
      return { id, kind: "connection", text: clip(entity.title), state: entity.status };
    case "secret":
      return { id, kind: "secret", text: clip(entity.name), state: entity.status };
    case "browser":
      return { id, kind: "browser", text: clip(entity.title), state: entity.status };
    case "schedule":
      return { id, kind: "schedule", text: clip(entity.title), state: entity.running ? "running" : entity.status };
    case "failure":
      return { id, kind: "failure", text: "", state: entity.status };
    case "prompt":
    case "instruction":
    case "question":
      return null;
  }
}

const cards: Record<Exclude<Quote["kind"], "reply">, string> = {
  task: "task card",
  approval: "approval card",
  connection: "connection card",
  secret: "secret request card",
  browser: "browser task card",
  schedule: "schedule card",
  failure: "\"could not reply\" card",
};

/** What the user replied to, as the agent reads it: the words of its message, or the card's kind, id, title and state. */
export function quoted(quote: Quote): string {
  if (quote.kind === "reply") return `your message "${quote.text}"`;
  const title = quote.text ? ` "${quote.text}"` : "";
  return `your ${cards[quote.kind]} ${quote.id}${title}${quote.state ? ` (${quote.state})` : ""}`;
}
