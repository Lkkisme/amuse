/**
 * The PIN on the web app's side. The server decides what needs it (api/src/sensitive.ts) and refuses a sensitive
 * call it has not unlocked; the app only answers that refusal: it asks for the PIN (or for one to be set), and makes
 * the call again once it is in. A call the user does not unlock fails as it would have.
 */
import { CallFailed } from "@amuse/api/client";
import { type Method, type Params, type Results, type Session, errors } from "@amuse/protocol";

/** What the server asked for: a PIN to be set first, or the PIN entered. */
export type Need = "unset" | "locked";
/** Ask the user: true once the PIN is set or entered, false when they let it be. */
export type Ask = (need: Need) => Promise<boolean>;

/** The PIN a failed call is waiting for, if that is why it failed. */
export function needOf(error: unknown): Need | null {
  if (!(error instanceof CallFailed)) return null;
  if (error.code === errors.pinUnset.code) return "unset";
  if (error.code === errors.pinLocked.code) return "locked";
  return null;
}

/** A session whose sensitive calls ask for the PIN when the server wants it, then go again, once. */
export function pinGuarded(session: Session, ask: Ask): Session {
  const call = async <M extends Method>(method: M, params: Params[M]): Promise<Results[M]> => {
    try {
      return await session.call(method, params);
    } catch (error) {
      const need = needOf(error);
      if (need === null || !(await ask(need))) throw error;
      return session.call(method, params);
    }
  };
  return { call, subscribe: (listener) => session.subscribe(listener) };
}

/** What the server said to an account request: done, or why not (with what the PIN wants, if that is why). */
export type Said = { ok: true } | { ok: false; reason: string; pin: Need | null; left: number | null; until: string | null };

/** An account request that may need the PIN: asked for, then tried again, once. */
export async function withPin(ask: Ask, attempt: () => Promise<Said>): Promise<Said> {
  const said = await attempt();
  if (said.ok || said.pin === null || !(await ask(said.pin))) return said;
  return attempt();
}

export const PIN_DIGITS = 6;
/** Only digits, at most six: what a PIN field keeps of what is typed or pasted. */
export const pinDigits = (typed: string) => typed.replace(/\D/g, "").slice(0, PIN_DIGITS);
