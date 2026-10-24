/**
 * Messages on their way: shown in the chat the moment they are sent (as
 * sending), before the server has them. Once it does, the chat shows its
 * message in the same place: the one on its way stands for it until then,
 * and the server's keeps its place (its key) so nothing flickers. One that
 * fails goes back to the composer (Composer.tsx).
 */
import type { Attachment, Entity, Prompt, Quote } from "@amuse/protocol";

export interface Outgoing {
  /** its place in the chat, kept by the server's message once it is there */
  key: string;
  chat: string;
  text: string;
  attachments: Attachment[];
  /** the item of Amuse's it replies to */
  quote: Quote | null;
  at: string;
  timezone: string;
  /** the server's id for it, once it said */
  sent: string | null;
  /** the last entity in the chat when it was sent: its message comes after it */
  after: string | null;
}

/**
 * What the chat shows for the messages on their way: those the server does not have yet, as
 * prompts (by their key), and, for those it has, the key its message keeps (by its id).
 */
export function outgoingIn(
  entities: Entity[],
  outgoing: Outgoing[],
  chat: string,
): { sending: Prompt[]; keys: Map<string, string> } {
  const sending: Prompt[] = [];
  const keys = new Map<string, string>();
  for (const o of outgoing) {
    if (o.chat !== chat) continue;
    const start =
      o.after === null ? 0 : entities.findIndex((e) => e.id === o.after) + 1;
    // its message: by the id the server gave, or (before the answer comes) the same words, new since it was sent
    const arrived = entities.find(
      (e, i) =>
        e.kind === "prompt" &&
        !keys.has(e.id) &&
        (e.id === o.sent ||
          (o.sent === null &&
            i >= start &&
            e.text === o.text &&
            e.attachments.length === o.attachments.length)),
    );
    if (arrived) keys.set(arrived.id, o.key);
    else if (o.sent === null || !entities.some((e) => e.id === o.sent))
      sending.push({
        kind: "prompt",
        id: o.key,
        at: o.at,
        text: o.text,
        timezone: o.timezone,
        attachments: o.attachments,
        quote: o.quote,
        suggested: false,
      });
  }
  return { sending, keys };
}
