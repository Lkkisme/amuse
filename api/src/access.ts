/**
 * Who may use this instance: whoever knows its master password. The first
 * visitor sets it (the instance holds nothing of theirs before: no keys, no
 * chats); from then on the password opens a session, kept as an HttpOnly
 * cookie. The file keeps the password's scrypt hash and the hashes of the
 * sessions open (a session id is never stored as it is). Deleting the file
 * (and restarting) lets the password be set again.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

/** scrypt's cost: about 50 ms and 32 MB a try */
const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 ** 2 };
export const MIN_PASSWORD = 8;
/** sessions kept at most (the oldest go first) */
const MAX_SESSIONS = 50;

const Stored = z.object({
  password: z.object({ salt: z.string(), hash: z.string() }),
  sessions: z.array(z.string()),
});
type Stored = z.infer<typeof Stored>;

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
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFC"), salt, 64, COST, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
const digest = (session: string) =>
  createHash("sha256").update(session).digest("hex");

export function fileAccess(path: string): Access {
  let stored: Stored | null = existsSync(path)
    ? Stored.parse(JSON.parse(readFileSync(path, "utf8")))
    : null;
  const save = (next: Stored) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    stored = next;
  };
  const hashOf = async (password: string) => {
    const salt = randomBytes(16);
    return {
      salt: salt.toString("hex"),
      hash: (await derive(password, salt)).toString("hex"),
    };
  };
  const matches = async (password: string) => {
    if (!stored) return false;
    const key = await derive(
      password,
      Buffer.from(stored.password.salt, "hex"),
    );
    return timingSafeEqual(key, Buffer.from(stored.password.hash, "hex"));
  };
  const open = (keep: string[]) => {
    const session = randomBytes(32).toString("base64url");
    if (stored)
      save({
        ...stored,
        sessions: [...keep, digest(session)].slice(-MAX_SESSIONS),
      });
    return session;
  };
  const acceptable = (password: string) => {
    if ([...password].length < MIN_PASSWORD)
      throw new PasswordRejected(
        `The password needs at least ${MIN_PASSWORD} characters.`,
      );
  };

  return {
    ready: () => stored !== null,
    async setup(password) {
      acceptable(password);
      if (stored) throw new PasswordRejected("The password is already set.");
      const hashed = await hashOf(password);
      if (stored) throw new PasswordRejected("The password is already set."); // set meanwhile
      save({ password: hashed, sessions: [] });
      return open([]);
    },
    async login(password) {
      if (!stored || !(await matches(password))) return null;
      return open(stored.sessions);
    },
    valid: (session) =>
      stored !== null && stored.sessions.includes(digest(session)),
    logout(session) {
      if (stored)
        save({
          ...stored,
          sessions: stored.sessions.filter((s) => s !== digest(session)),
        });
    },
    async change(current, next) {
      acceptable(next);
      if (!stored || !(await matches(current))) return null;
      save({ password: await hashOf(next), sessions: [] });
      return open([]);
    },
  };
}
