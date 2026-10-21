/**
 * Chats: the main chat, and side chats the user opens beside it. Each chat
 * is its own stream of events (events.ts) and its own feed; the server
 * pushes every chat's events, each marked with its chat, and the list of
 * chats whenever it changes.
 */
import { z } from "zod";
import { Id, Instant } from "./entities.ts";
import { Envelope } from "./events.ts";

/** The main chat's id: it is always there and cannot be renamed or deleted. */
export const MAIN = "main";

export const Chat = z.object({
  id: Id,
  /** "" until it has one (a side chat is named after its first message) */
  title: z.string().max(80),
  at: Instant,
  /** when something was last said in it */
  updated: Instant,
});

/** What the server pushes: one chat's next event, or the chats as they now are. */
export const Push = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), chat: Id, envelope: Envelope }),
  z.object({ kind: z.literal("chats"), chats: z.array(Chat) }),
]);

export type Chat = z.infer<typeof Chat>;
export type Push = z.infer<typeof Push>;
