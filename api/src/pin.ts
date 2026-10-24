/**
 * The PIN: six digits that authorize sensitive actions (which ones: sensitive.ts). It is not a key to anything: the
 * server checks it, and an unlock it opens lets one session (one device) do sensitive things for a while. Only its
 * scrypt hash is kept, in the database; it never goes into the chat, the journal or a log.
 *
 * - Wrong tries: after 5 in a row the PIN locks for 15 minutes, then each lockout lasts twice the one before (at most
 *   a day). The count is the account's, in the database, so neither another device nor a restart starts it over.
 * - An unlock lasts `minutes` (5 unless the user chose 1, 15 or 30) after the last sensitive action, and 30 minutes at
 *   most from when the PIN was entered. It is kept in memory only: a restart locks every session.
 * - Reminders: with no PIN, the app asks for one; with one not entered for 7 days, it asks for it once, so it is not
 *   forgotten. "Later" puts either off for a day, for every device.
 * - The PIN is optional: the owner can turn it off (Settings › Security, or from the first prompt). With it off, this is
 *   the one place that still decides: it treats every session as unlocked, and asks nothing. Turning it on again is
 *   setting a PIN, which needs the password.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { type Db, queryOne, transaction } from "@amuse/db";
import { z } from "zod";
import { COST, digest } from "./access.ts";

export const PIN_DIGITS = 6;
/** wrong tries in a row before the PIN locks */
export const TRIES = 5;
const MINUTE = 60_000;
/** the first lockout; each after it lasts twice as long */
export const LOCKOUT_MS = 15 * MINUTE;
/** the longest lockout: past it, waiting longer protects nothing that the tries left do not */
const LONGEST_LOCKOUT_MS = 24 * 60 * MINUTE;
/** how long an unlock can last, however busy the session is */
export const UNLOCK_CAP_MS = 30 * MINUTE;
/** the lengths an unlock can be set to, in minutes */
export const LENGTHS = [1, 5, 15, 30];
/** a PIN not entered for this long is asked for once, so it is not forgotten */
export const REMIND_MS = 7 * 24 * 60 * MINUTE;
/** how long "Later" puts a reminder off */
export const LATER_MS = 24 * 60 * MINUTE;

/** A PIN that is not six digits. */
export class PinRejected extends Error {}

/** A sensitive action without an unlock: there is no PIN yet ("unset"), or it has to be entered ("locked"). */
export class PinRequired extends Error {
  readonly need: "unset" | "locked";
  constructor(need: "unset" | "locked") {
    super(need === "unset" ? "Set a PIN first: it authorizes sensitive actions." : "Enter your PIN to do this.");
    this.need = need;
  }
}

/** What a try at the PIN came to. */
export type Tried = { kind: "right" } | { kind: "wrong"; left: number } | { kind: "locked"; until: string };

/** What the app is to ask: a PIN to be set, the PIN to be confirmed (not entered for a week), or nothing now. */
export type Reminder = "set" | "confirm" | null;

export interface Pin {
  /** A PIN is in force: it is set, and not turned off. */
  isSet(): boolean;
  /** The owner turned it off: sensitive actions go through, nothing is asked, and no reminder comes back. */
  off(): boolean;
  /** Set it, or a new one: tries and reminders start over, and it is on again. Throws PinRejected for one that is not six digits. */
  set(pin: string): Promise<void>;
  /** Turn it off: the PIN it had is forgotten, with its tries and its reminders. */
  turnOff(): void;
  /** Try it, counting toward the lockout. A right try restarts the 7 days. */
  check(pin: string): Promise<Tried>;
  /** Until when it is locked after wrong tries, if it is now. */
  locked(): string | null;
  reminder(): Reminder;
  /** Put the reminder off for a day. */
  later(): void;
  /** How long an unlock lasts after the last sensitive action. */
  minutes(): number;
  setMinutes(minutes: number): void;
}

const Row = z.object({
  salt: z.string().nullable(),
  hash: z.string().nullable(),
  used: z.string().nullable(),
  later: z.string().nullable(),
  wrong: z.number(),
  lockouts: z.number(),
  locked: z.string().nullable(),
  minutes: z.number(),
  off: z.number(),
});

const derive = (pin: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(pin, salt, 64, COST, (error, key) => (error ? reject(error) : resolve(key))));

export const wellFormed = (pin: string) => new RegExp(`^\\d{${PIN_DIGITS}}$`).test(pin);

export function sqlitePin(db: Db, { now = Date.now }: { now?: () => number } = {}): Pin {
  const stamp = (at = now()) => new Date(at).toISOString();
  // the migration makes the one row; a database without it is not one this code can run on
  const row = () => {
    const found = queryOne(db, Row, "select salt, hash, used, later, wrong, lockouts, locked, minutes, off from pin where id = 1");
    if (!found) throw new Error("The database has no PIN row: its migrations did not run.");
    return found;
  };
  const lockedUntil = () => {
    const { locked } = row();
    return locked !== null && Date.parse(locked) > now() ? locked : null;
  };
  /** one try at a time, so tries made at once cannot get past the count together */
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => {});
    return next;
  };

  return {
    isSet() {
      const { hash, off } = row();
      return hash !== null && off === 0;
    },
    off: () => row().off === 1,
    async set(pin) {
      if (!wellFormed(pin)) throw new PinRejected(`A PIN is ${PIN_DIGITS} digits.`);
      const salt = randomBytes(16);
      const hash = await derive(pin, salt);
      db.prepare("update pin set off = 0, salt = ?, hash = ?, used = ?, later = null, wrong = 0, lockouts = 0, locked = null where id = 1").run(salt.toString("hex"), hash.toString("hex"), stamp());
    },
    turnOff() {
      db.prepare("update pin set off = 1, salt = null, hash = null, used = null, later = null, wrong = 0, lockouts = 0, locked = null where id = 1").run();
    },
    check: (pin) =>
      inTurn(async (): Promise<Tried> => {
        const until = lockedUntil();
        if (until) return { kind: "locked", until };
        const kept = row();
        if (kept.salt === null || kept.hash === null) return { kind: "wrong", left: TRIES };
        const key = await derive(wellFormed(pin) ? pin : "", Buffer.from(kept.salt, "hex"));
        if (wellFormed(pin) && timingSafeEqual(key, Buffer.from(kept.hash, "hex"))) {
          db.prepare("update pin set used = ?, wrong = 0, lockouts = 0, locked = null where id = 1").run(stamp());
          return { kind: "right" };
        }
        return transaction(db, (): Tried => {
          const { wrong, lockouts } = row();
          if (wrong + 1 < TRIES) {
            db.prepare("update pin set wrong = ? where id = 1").run(wrong + 1);
            return { kind: "wrong", left: TRIES - wrong - 1 };
          }
          const locked = stamp(now() + Math.min(LOCKOUT_MS * 2 ** lockouts, LONGEST_LOCKOUT_MS));
          db.prepare("update pin set wrong = 0, lockouts = ?, locked = ? where id = 1").run(lockouts + 1, locked);
          return { kind: "locked", until: locked };
        });
      }),
    locked: lockedUntil,
    reminder() {
      const { hash, used, later, off } = row();
      if (off === 1) return null;
      if (later !== null && Date.parse(later) > now()) return null;
      if (hash === null) return "set";
      return used === null || now() - Date.parse(used) >= REMIND_MS ? "confirm" : null;
    },
    later() {
      db.prepare("update pin set later = ? where id = 1").run(stamp(now() + LATER_MS));
    },
    minutes: () => row().minutes,
    setMinutes(minutes) {
      if (!LENGTHS.includes(minutes)) throw new PinRejected(`An unlock lasts ${LENGTHS.join(", ")} minutes.`);
      db.prepare("update pin set minutes = ? where id = 1").run(minutes);
    },
  };
}

/** Forget the PIN, its tries and its reminders, and sign every device out (`amuse-admin reset-pin`): it is off until one is set. */
export function resetPin(db: Db): void {
  transaction(db, () => {
    db.exec("update pin set off = 1, salt = null, hash = null, used = null, later = null, wrong = 0, lockouts = 0, locked = null where id = 1");
    db.exec("delete from sessions");
  });
}

/** The unlocks the PIN opened, by session: in memory only, so a restart locks them all. */
export interface Unlocks {
  /** The PIN was entered on this session (or set on it). */
  open(session: string): void;
  lock(session: string): void;
  /**
   * The check every sensitive action makes, on the server: throws PinRequired unless this session is unlocked now, and
   * keeps the unlock open for another `minutes` (within its 30) when it is. Call it right before the action, after
   * anything that may still refuse the call for another reason. With the PIN off it asks nothing: this is the one place
   * that decides that, so no client has to know.
   */
  require(session: string): void;
  /** Until when this session is unlocked, without counting as an action; null: it is not. */
  until(session: string): string | null;
}

/** `valid`: whether the session is still open (an unlock ends with its session, whoever ended it). */
export function unlocks(pin: Pin, valid: (session: string) => boolean, { now = Date.now }: { now?: () => number } = {}): Unlocks {
  const open = new Map<string, { since: number; last: number }>();
  const ends = (window: { since: number; last: number }) => Math.min(window.last + pin.minutes() * MINUTE, window.since + UNLOCK_CAP_MS);
  /** this session's unlock, if it is still open */
  const current = (session: string) => {
    const key = digest(session);
    const window = open.get(key);
    if (!window) return null;
    if (now() >= ends(window) || !valid(session) || !pin.isSet()) {
      open.delete(key);
      return null;
    }
    return window;
  };
  return {
    open(session) {
      // the sessions that ended meanwhile go too
      for (const [key, window] of open) if (now() >= ends(window)) open.delete(key);
      open.set(digest(session), { since: now(), last: now() });
    },
    lock: (session) => void open.delete(digest(session)),
    require(session) {
      // off: every session is unlocked, and stays so until a PIN is set again
      if (pin.off()) return;
      if (!pin.isSet()) throw new PinRequired("unset");
      const window = current(session);
      if (!window) throw new PinRequired("locked");
      window.last = now();
    },
    until(session) {
      const window = current(session);
      return window ? new Date(ends(window)).toISOString() : null;
    },
  };
}
