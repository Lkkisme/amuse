/**
 * The live browser channel: its own WebSocket per browser run (/live), not
 * JSON-RPC. Server → client: binary JPEG frames, plus `Screen` text messages
 * when the page size, URL or title change. Client → server: `Input`, honored
 * only while the run is paused (the user is in control).
 * Coordinates are fractions of the frame (0..1), so the client never needs
 * the page's pixel size to point at it.
 */
import { z } from "zod";

const Fraction = z.number().min(0).max(1);
const Button = z.enum(["left", "middle", "right"]);

export const Input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pointer"), action: z.enum(["down", "up", "move"]), x: Fraction, y: Fraction, button: Button }),
  z.object({ kind: z.literal("wheel"), x: Fraction, y: Fraction, dx: z.number(), dy: z.number() }),
  /** `key` is a DOM KeyboardEvent.key ("a", "Enter", "Backspace") */
  z.object({ kind: z.literal("key"), action: z.enum(["down", "up"]), key: z.string().min(1) }),
  /** committed text (IME, paste, mobile keyboards) */
  z.object({ kind: z.literal("text"), text: z.string().min(1) }),
]);

export const Screen = z.object({
  kind: z.literal("screen"),
  width: z.int().positive(),
  height: z.int().positive(),
  url: z.string(),
  title: z.string(),
});

export type Input = z.infer<typeof Input>;
export type Screen = z.infer<typeof Screen>;
