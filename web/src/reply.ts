/**
 * Replying to an item of Amuse's, in words: what the quote bar over the composer and the quote over the user's message
 * say of the item replied to (its words, or its card's kind and title).
 */
import type { Quote } from "@amuse/protocol";
import type { Messages } from "./i18n/en.ts";

/** A quote as one line of text: a message's words; a card's kind and title ("Scheduled task · Morning briefing"). */
export function quoteLine(quote: Quote, t: Messages): string {
  if (quote.kind === "prompt" || quote.kind === "reply") return quote.text || t.chat.quoted[quote.kind];
  const kind = t.chat.quoted[quote.kind];
  return quote.text ? `${kind} · ${quote.text}` : kind;
}
