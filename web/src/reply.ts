/**
 * Replying to an item of Amuse's, in words: what the quote bar over the composer and the quote over the user's message
 * say of the item replied to (its words, or its card's kind and title).
 */
import type { Quote } from "@amuse/protocol";
import type { ErrorAbout } from "./ask.tsx";
import type { Ui } from "./ui.ts";
import type { Messages } from "./i18n/en.ts";

/** A quote as one line of text: a message's words; a card's kind and title ("Scheduled task · Morning briefing"). */
export function quoteLine(quote: Quote, t: Messages): string {
  if (quote.kind === "prompt" || quote.kind === "reply") return quote.text || t.chat.quoted[quote.kind];
  if (quote.kind === "error") return quote.text || t.chat.quoted.error;
  const kind = t.chat.quoted[quote.kind];
  return quote.text ? `${kind} · ${quote.text}` : kind;
}

/**
 * Asking Amuse about an error changes what is on screen and sends nothing: the error becomes the quote over the composer
 * (its message shown, its detail kept for the agent), and whatever covers the chat (Settings, a sheet) gives way to it.
 * The message goes only when the user sends it.
 */
export function asking(ui: Ui, chat: string, about: ErrorAbout, id: string): Ui {
  const quote: Quote = { id, kind: "error", text: about.message, state: null, detail: about.detail };
  return { ...ui, notice: null, noticeAbout: null, explainer: null, taskDetail: null, settings: { ...ui.settings, open: false }, replying: { chat, quote } };
}

/** The line the composer starts with when asking about an error: words the user already typed are kept as they are. */
export const askLine = (typed: string, line: string): string => (typed.trim() ? typed : line);
