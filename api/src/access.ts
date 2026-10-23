/**
 * Who may use this instance: whoever knows its master password. The first
 * visitor sets it (the instance holds nothing of theirs before: no keys, no
 * chats); from then on the password opens a session, kept as an HttpOnly
 * cookie. The database keeps the password's scrypt hash and the hashes of the
 * sessions open (a session id is never stored as it is). `amuse-admin reset-password`
 * lets the password be set again.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { type Db, queryOne, transaction } from "@amuse/db";
import { z } from "zod";

/** scrypt's cost: about 50 ms and 32 MB a try */
const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 ** 2 };
export const MIN_PASSWORD = 8;
/** sessions kept at most (the oldest go first) */
const MAX_SESSIONS = 50;

const Password = z.object({ salt: z.string(), hash: z.string() });
type Password = z.infer<typeof Password>;

export class PasswordRejected extends Error {}

export interface Access {
  /** Whether the master password is set. */
  ready(): boolean;
  /** Set the master password, the first time only: a session for the one who set it. */
  setup(password: string): Promise<string>;
  /** A session for the right password; null for a wrong one. */
  login(password: string): Promise<string | null>;
  valid(session: string): boolean;
  logout(session: string): void;
  /** Change the password (the current one first): every other session ends; a new one for this device. Null: the current one was wrong. */
  change(current: string, next: string): Promise<string | null>;
}

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize("NFC"), salt, 64, COST, (error, key) => (error ? reject(error) : resolve(key))));
const digest = (session: string) => createHash("sha256").update(session).digest("hex");

export function sqliteAccess(db: Db): Access {
  const stored = () => queryOne(db, Password, "select salt, hash from access");
  /** The password and its sessions replaced together; the sessions of any earlier password end. */
  const replace = (password: Password) =>
    transaction(db, () => {
      db.exec("delete from access; delete from sessions");
      db.prepare("insert into access (id, salt, hash) values (1, ?, ?)").run(password.salt, password.hash);
    });
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
  /** A new session, added after the ones open (the oldest go beyond the most kept). */
  const open = () => {
    const session = randomBytes(32).toString("base64url");
    transaction(db, () => {
      db.prepare("insert into sessions (digest) values (?)").run(digest(session));
      db.prepare("delete from sessions where position not in (select position from sessions order by position desc limit ?)").run(MAX_SESSIONS);
    });
    return session;
  };
  const acceptable = (password: string) => {
    if ([...password].length < MIN_PASSWORD) throw new PasswordRejected(`The password needs at least ${MIN_PASSWORD} characters.`);
  };

  return {
    ready: () => stored() !== null,
    async setup(password) {
      acceptable(password);
      if (stored()) throw new PasswordRejected("The password is already set.");
      const hashed = await hashOf(password);
      if (stored()) throw new PasswordRejected("The password is already set."); // set meanwhile
      replace(hashed);
      return open();
    },
    async login(password) {
      if (!(await matches(password))) return null;
      return open();
    },
    valid: (session) => queryOne(db, z.object({ there: z.number() }), "select 1 as there from sessions where digest = ?", digest(session)) !== null,
    logout(session) {
      db.prepare("delete from sessions where digest = ?").run(digest(session));
    },
    async change(current, next) {
      acceptable(next);
      if (!(await matches(current))) return null;
      replace(await hashOf(next));
      return open();
    },
  };
}

/** Forget the password and every session: the next visit sets a new one (`amuse-admin reset-password`). */
export function resetPassword(db: Db): void {
  transaction(db, () => db.exec("delete from access; delete from sessions"));
}
