/**
 * The PIN's entry rules, away from React: what a field keeps of what is typed or pasted, and which of the six
 * boxes the caret is in (components/PinInput.tsx draws them). The PIN itself, and what needs it, is pin.ts.
 */
import { PIN_DIGITS } from "./pin.ts";

/** Only digits, at most six: what a PIN field keeps of what is typed. */
export const pinDigits = (typed: string) => typed.replace(/\D/g, "").slice(0, PIN_DIGITS);

/**
 * What a paste leaves in a field showing `current`: one carrying a whole PIN of its own replaces what is there
 * (the code from a message, or the PIN copied from somewhere), anything shorter is added to it, six at most.
 */
export function pastePin(current: string, pasted: string): string {
  const digits = pinDigits(pasted);
  return digits.length === PIN_DIGITS ? digits : pinDigits(current + digits);
}

/** The box the caret shows in: the next empty one, and the last one once all six are full. */
export const nextBox = (value: string) => Math.min(value.length, PIN_DIGITS - 1);
