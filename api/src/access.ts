/**
 * Who may use this instance: whoever knows its master password, on a device a
 * trusted one has let in. The first visitor sets the password (the instance
 * holds nothing of theirs before: no keys, no chats), and that device is
 * trusted. On any other device the right password only asks: the device waits
 * until a trusted, signed-in device approves it (with the PIN, pin.ts), and
 * then it opens sessions with the password like the first. A device is known by
 * a cookie of its own, apart from the session's, so locking a device (ending
 * its session) does not make it new again. When no device is trusted (every one
 * revoked, or `amuse-admin reset-devices`), the next right password trusts its
 * device, as the first visit did.
 *
 * Sessions are kept as HttpOnly cookies. The database keeps the password's
 * scrypt hash and the hashes of the sessions and device cookies (neither is
 * ever stored as it is). `amuse-admin reset-password` lets the password be set
 * again.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { type Db, query, queryOne, transaction } from "@amuse/db";
import { z } from "zod";

/** scrypt's cost: about 50 ms and 32 MB a try */
export const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 ** 2 };
export const MIN_PASSWORD = 8;
/** sessions kept at most (the oldest go first) */
export const MAX_SESSIONS = 50;
/** how long a device waits for approval after the password was given on it */
export const ASK_MS = 10 * 60_000;
/** devices that are not trusted, kept at most (the ones asked longest ago go first) */
const MAX_WAITING = 20;

const Password = z.object({ salt: z.string(), hash: z.string() });
type Password = z.infer<typeof Password>;

export class PasswordRejected extends Error {}

/** What a request says of the device it comes from: shown on the card that approves it. */
export interface Seen {
  agent: string;
  address: string;
}

/** A device as Settings lists it: trusted, or waiting for approval. */
export interface Device {
  id: string;
  trusted: boolean;
  waiting: boolean;
  agent: string;
  address: string;
  at: string;
  seen: string;
}

/**
 * What the password opens on a device: a session (and the device's cookie, when it gets a new one), or a wait for
 * approval (with the cookie to wait with, when it is new).
 */
export type Entry = { kind: "in"; session: string; device: string | null } | { kind: "waiting"; device: string | null };

export interface Access {
  /** Whether the master password is set. */
  ready(): boolean;
  /** Set the master password, the first time only: a session for the one who set it, on a device now trusted. */
  setup(password: string, device: string | null, seen: Seen): Promise<Entry>;
  /** What the right password opens on this device (its cookie, if it has one); null for a wrong password. */
  login(password: string, device: string | null, seen: Seen): Promise<Entry | null>;
  /** A device that was waiting and has been approved since: its session, once. Null when it is not (or no longer) so. */
  admitted(device: string | null, seen: Seen): Entry | null;
  /** Whether this device waits for approval now. */
  waiting(device: string | null): boolean;
  valid(session: string): boolean;
  logout(session: string): void;
  /** Change the password (the current one first): every other session ends; a new one for this device. Null: the current one was wrong. */
  change(session: string, current: string, next: string): Promise<string | null>;
  /** Whether this is the password, without opening anything (setting the PIN asks for it). */
  matches(password: string): Promise<boolean>;
  /**
   * A session's device, by id, with a cookie for it when it has none yet (a session from before devices were known):
   * the cookie is made once, and given with the next answer.
   */
  deviceOf(session: string): { id: string; cookie: string | null } | null;
  /** The trusted devices, and those waiting for approval now. */
  devices(): Device[];
  /** Trust a device that waits (its next poll opens its session). False: there is none such. */
  approve(id: string): boolean;
  /** Turn a waiting device away. */
  deny(id: string): void;
  /** Stop trusting a device: its sessions end. */
  revoke(id: string): void;
}

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize("NFC"), salt, 64, COST, (error, key) => (error ? reject(error) : resolve(key))));
export const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");

const Row = z.object({
  id: z.string(),
  digest: z.string().nullable(),
  trusted: z.number(),
  asked: z.string().nullable(),
  agent: z.string(),
  address: z.string(),
  at: z.string(),
  seen: z.string(),
});
type Row = z.infer<typeof Row>;

/** What is kept of what a device says: enough to tell it apart on a card, never a whole header. */
const kept = (seen: Seen): Seen => ({ agent: seen.agent.slice(0, 300), address: seen.address.slice(0, 100) });

export function sqliteAccess(db: Db, { now = Date.now }: { now?: () => number } = {}): Access {
  const stamp = () => new Date(now()).toISOString();
  const stored = () => queryOne(db, Password, "select salt, hash from access");
  const hashOf = async (password: string) => {
    const salt = randomBytes(16);
    return {
      salt: salt.toString("hex"),
      hash: (await derive(password, salt)).toString("hex"),
    };
  };
  const matches = async (password: string) => {
    const kept = stored();
    if (!kept) return false;
    const key = await derive(password, Buffer.from(kept.salt, "hex"));
    return timingSafeEqual(key, Buffer.from(kept.hash, "hex"));
  };
  const deviceBy = (cookie: string | null) => (cookie === null ? null : queryOne(db, Row, "select * from devices where digest = ?", digest(cookie)));
  const anyTrusted = () => queryOne(db, z.object({ there: z.number() }), "select 1 as there from devices where trusted = 1 limit 1") !== null;
  /** whether a device's ask is recent enough to be answered */
  const asking = (row: Row) => row.asked !== null && now() - Date.parse(row.asked) < ASK_MS;
  /** A new device, with its cookie. */
  const add = (seen: Seen, trusted: boolean) => {
    const cookie = token();
    const id = randomBytes(9).toString("base64url");
    const { agent, address } = kept(seen);
    transaction(db, () => {
      db.prepare("insert into devices (id, digest, trusted, asked, agent, address, at, seen) values (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id,
        digest(cookie),
        trusted ? 1 : 0,
        trusted ? null : stamp(),
        agent,
        address,
        stamp(),
        stamp(),
      );
      // the ones asked longest ago go beyond the most kept: no one can fill the list by asking
      db.prepare("delete from devices where trusted = 0 and id not in (select id from devices where trusted = 0 order by asked desc limit ?)").run(MAX_WAITING);
    });
    return { id, cookie };
  };
  const touch = (id: string, seen: Seen) => {
    const { agent, address } = kept(seen);
    db.prepare("update devices set agent = ?, address = ?, seen = ? where id = ?").run(agent, address, stamp(), id);
  };
  /** A new session on a device, added after the ones open (the oldest go beyond the most kept). */
  const open = (device: string) => {
    const session = token();
    transaction(db, () => {
      db.prepare("insert into sessions (digest, device) values (?, ?)").run(digest(session), device);
      db.prepare("delete from sessions where position not in (select position from sessions order by position desc limit ?)").run(MAX_SESSIONS);
    });
    return session;
  };
  /** The right password on a device: in when it is trusted (or when none is: then it becomes so), else it waits. */
  const enter = (cookie: string | null, seen: Seen): Entry => {
    const known = deviceBy(cookie);
    if (known?.trusted === 1) {
      touch(known.id, seen);
      return { kind: "in", session: open(known.id), device: null };
    }
    if (!anyTrusted()) {
      if (known) {
        db.prepare("update devices set trusted = 1, asked = null where id = ?").run(known.id);
        touch(known.id, seen);
        return { kind: "in", session: open(known.id), device: null };
      }
      const made = add(seen, true);
      return { kind: "in", session: open(made.id), device: made.cookie };
    }
    if (known) {
      db.prepare("update devices set asked = ? where id = ?").run(stamp(), known.id);
      touch(known.id, seen);
      return { kind: "waiting", device: null };
    }
    return { kind: "waiting", device: add(seen, false).cookie };
  };
  const acceptable = (password: string) => {
    if ([...password].length < MIN_PASSWORD) throw new PasswordRejected(`The password needs at least ${MIN_PASSWORD} characters.`);
  };
  const sessionRow = (session: string) => queryOne(db, z.object({ device: z.string() }), "select device from sessions where digest = ?", digest(session));

  return {
    ready: () => stored() !== null,
    async setup(password, cookie, seen) {
      acceptable(password);
      if (stored()) throw new PasswordRejected("The password is already set.");
      const hashed = await hashOf(password);
      if (stored()) throw new PasswordRejected("The password is already set."); // set meanwhile
      // the first device: whatever was trusted under an earlier password is not any more, and its sessions end
      transaction(db, () => {
        db.exec("delete from access; delete from sessions; delete from devices");
        db.prepare("insert into access (id, salt, hash) values (1, ?, ?)").run(hashed.salt, hashed.hash);
      });
      return enter(cookie, seen);
    },
    async login(password, cookie, seen) {
      if (!(await matches(password))) return null;
      return enter(cookie, seen);
    },
    admitted(cookie, seen) {
      const known = deviceBy(cookie);
      if (!known || known.trusted !== 1 || !asking(known)) return null;
      db.prepare("update devices set asked = null where id = ?").run(known.id);
      touch(known.id, seen);
      return { kind: "in", session: open(known.id), device: null };
    },
    waiting(cookie) {
      const known = deviceBy(cookie);
      return known !== null && known.trusted === 0 && asking(known);
    },
    valid: (session) => sessionRow(session) !== null,
    logout(session) {
      db.prepare("delete from sessions where digest = ?").run(digest(session));
    },
    async change(session, current, next) {
      acceptable(next);
      const mine = sessionRow(session);
      if (!mine || !(await matches(current))) return null;
      const hashed = await hashOf(next);
      // the devices stay trusted; their sessions end, and this device gets a new one
      transaction(db, () => {
        db.exec("delete from access; delete from sessions");
        db.prepare("insert into access (id, salt, hash) values (1, ?, ?)").run(hashed.salt, hashed.hash);
      });
      return open(mine.device);
    },
    matches,
    deviceOf(session) {
      const mine = sessionRow(session);
      if (!mine) return null;
      const row = queryOne(db, Row, "select * from devices where id = ?", mine.device);
      if (!row) return null;
      if (row.digest !== null) return { id: row.id, cookie: null };
      const cookie = token();
      db.prepare("update devices set digest = ? where id = ? and digest is null").run(digest(cookie), row.id);
      return { id: row.id, cookie };
    },
    devices: () =>
      query(db, Row, "select * from devices order by at")
        .filter((row) => row.trusted === 1 || asking(row))
        .map((row) => ({ id: row.id, trusted: row.trusted === 1, waiting: row.trusted === 0, agent: row.agent, address: row.address, at: row.at, seen: row.seen })),
    approve(id) {
      const row = queryOne(db, Row, "select * from devices where id = ?", id);
      if (!row || row.trusted === 1 || !asking(row)) return false;
      db.prepare("update devices set trusted = 1 where id = ?").run(id);
      return true;
    },
    deny(id) {
      db.prepare("delete from devices where id = ? and trusted = 0").run(id);
    },
    revoke(id) {
      db.prepare("delete from devices where id = ?").run(id);
    },
  };
}

/** Forget the password and every session: the next visit sets a new one (`amuse-admin reset-password`). */
export function resetPassword(db: Db): void {
  transaction(db, () => db.exec("delete from access; delete from sessions"));
}

/** Trust no device: every session ends, and the next right password trusts its device, as the first visit did (`amuse-admin reset-devices`). */
export function resetDevices(db: Db): void {
  transaction(db, () => db.exec("delete from sessions; delete from devices"));
}
